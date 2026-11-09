import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * F9 (FR-018, D7A): the images are the artefact that reaches production, so these tests keep their
 * base images pinned, Debian-based and non-root, and keep the build context free of the local
 * `.env` and the host `node_modules`. They fail on their own if someone relaxes one of those rules.
 */
const ROOT = resolve(import.meta.dirname, '../../..');
const read = (file: string): string => readFileSync(resolve(ROOT, file), 'utf8');

const DOCKERFILES = [
  'apps/api/Dockerfile',
  'apps/worker/Dockerfile',
  'apps/web/Dockerfile',
  'packages/db/Dockerfile',
];
const COMPOSE_FILES = ['compose.yaml', 'deploy/compose.prod.yaml'].filter((file) =>
  existsSync(resolve(ROOT, file)),
);

interface Stage {
  /** Image reference after resolving `ARG` defaults. */
  image: string;
  name: string | undefined;
  users: string[];
  copies: string[];
  lines: string[];
}

/** Joins `\` continuations and drops comments, so every instruction is one line. */
function instructions(source: string): string[] {
  const joined = source.replace(/\\\r?\n/g, ' ');
  return joined
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

function parse(file: string): Stage[] {
  const args = new Map<string, string>();
  const stages: Stage[] = [];
  for (const line of instructions(read(file))) {
    const arg = /^ARG\s+(\w+)=(\S+)/.exec(line);
    if (arg?.[1] && arg[2] && stages.length === 0) args.set(arg[1], arg[2]);
    const from = /^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(line);
    if (from?.[1]) {
      const image = from[1].replace(/\$\{(\w+)\}|\$(\w+)/g, (_m, a: string, b: string) => {
        return args.get(a ?? b) ?? '';
      });
      stages.push({ image, name: from[2], users: [], copies: [], lines: [] });
      continue;
    }
    const stage = stages.at(-1);
    if (!stage) continue;
    stage.lines.push(line);
    const user = /^USER\s+(\S+)/i.exec(line);
    if (user?.[1]) stage.users.push(user[1]);
    if (/^(COPY|ADD)\s/i.test(line)) stage.copies.push(line);
  }
  return stages;
}

describe('Dockerfiles', () => {
  it.each(DOCKERFILES)('%s exists', (file) => {
    expect(existsSync(resolve(ROOT, file))).toBe(true);
  });

  describe.each(DOCKERFILES)('%s', (file) => {
    const stages = existsSync(resolve(ROOT, file)) ? parse(file) : [];

    it('pins every FROM by digest', () => {
      expect(stages.length).toBeGreaterThan(0);
      for (const stage of stages) {
        // A `FROM <earlier-stage>` has no digest of its own.
        if (stages.some((other) => other.name === stage.image)) continue;
        expect(stage.image, stage.image).toMatch(/@sha256:[0-9a-f]{64}$/);
      }
    });

    it('never uses an Alpine image or a musl-based runtime', () => {
      for (const stage of stages) expect(stage.image.toLowerCase()).not.toContain('alpine');
    });

    it('ends on a Debian bookworm-slim base', () => {
      expect(stages.at(-1)?.image).toMatch(/bookworm-slim@sha256:/);
    });

    it('does not run as root in the final stage', () => {
      const users = stages.at(-1)?.users ?? [];
      expect(users.length, 'the final stage must set USER').toBeGreaterThan(0);
      const last = (users.at(-1) ?? '').split(':')[0];
      expect(['root', '0', '']).not.toContain(last);
    });

    it('copies neither .env nor a host node_modules', () => {
      for (const stage of stages) {
        for (const copy of stage.copies) {
          if (/--from=/.test(copy)) continue;
          expect(copy, copy).not.toMatch(/(^|[\s/])\.env(\.|\s|$)/);
          expect(copy, copy).not.toContain('node_modules');
        }
      }
    });

    it('installs dependencies inside the image from the lockfile', () => {
      const text = read(file);
      expect(text).toContain('pnpm install --frozen-lockfile');
    });
  });

  it('keeps .env and node_modules out of the build context', () => {
    const ignore = read('.dockerignore')
      .split(/\r?\n/)
      .map((line) => line.trim());
    expect(ignore).toContain('.env');
    expect(ignore).toContain('.env.*');
    expect(ignore).toContain('**/node_modules');
  });

  it('does not bake VITE_API_URL into the edge image (same origin, D6A)', () => {
    const text = read('apps/web/Dockerfile');
    expect(text).not.toMatch(/^\s*(ARG|ENV)\s+VITE_API_URL(=\S+)?\s*$/m);
    expect(text).not.toMatch(/VITE_API_URL=\S+/);
  });

  it('runs the migrator with drizzle-orm only: no drizzle-kit, no esbuild, no server', () => {
    const text = read('packages/db/Dockerfile');
    const code = instructions(text).join('\n');
    expect(code).toMatch(/migrate-cli/);
    expect(code).toMatch(/pnpm deploy .*--prod/);
    expect(code).not.toMatch(/drizzle-kit|esbuild/);
    expect(text).not.toMatch(/^EXPOSE\s/m);
  });

  it('removes npm, npx and corepack from every Node runtime stage', () => {
    for (const file of DOCKERFILES) {
      const final = parse(file).at(-1);
      if (!final || !/^node:/.test(final.image)) continue;
      const removal = final.lines
        .filter((line) => /^RUN\s/.test(line) && /\brm\b/.test(line))
        .join(' ');
      for (const path of [
        '/usr/local/lib/node_modules/npm',
        '/usr/local/lib/node_modules/corepack',
        '/usr/local/bin/npm',
        '/usr/local/bin/npx',
        '/usr/local/bin/corepack',
      ]) {
        expect(removal, `${file} must remove ${path}`).toContain(path);
      }
    }
  });

  it('installs ca-certificates in every Debian final image that runs Caddy (ACME needs the roots)', () => {
    for (const file of DOCKERFILES) {
      const stages = parse(file);
      const final = stages.at(-1);
      if (!final || !/bookworm-slim@/.test(final.image)) continue;
      const runsCaddy = final.lines.some(
        (line) => /caddy/i.test(line) && /^(CMD|ENTRYPOINT)/i.test(line),
      );
      if (!runsCaddy) continue;
      const install = final.lines.find((line) => /apt-get install/.test(line));
      expect(install, `${file} must apt-get install ca-certificates`).toMatch(
        /\bca-certificates\b/,
      );
      const userAt = final.lines.findIndex((line) => /^USER\s/i.test(line));
      expect(final.lines.indexOf(install ?? ''), 'installed before USER').toBeLessThan(userAt);
    }
  });

  describe('edge image builds Caddy from source with the fixed dependencies (ADR-0090)', () => {
    const stages = parse('apps/web/Dockerfile');
    const goMod = read('deploy/caddy/build/go.mod');
    const versionOf = (module: string): number[] => {
      const line = goMod
        .split(/\r?\n/)
        .map((entry) => entry.trim().replace(/^require\s+/, ''))
        .find((entry) => entry.startsWith(`${module} v`));
      const match = /\sv(\d+)\.(\d+)\.(\d+)/.exec(line ?? '');
      return match ? match.slice(1).map(Number) : [];
    };
    const atLeast = (found: number[], minimum: number[]): boolean => {
      if (found.length !== 3) return false;
      for (let i = 0; i < 3; i += 1) {
        if (found[i] !== minimum[i]) return (found[i] ?? 0) > (minimum[i] ?? 0);
      }
      return true;
    };

    it('copies no binary from a caddy:* image', () => {
      const text = read('apps/web/Dockerfile');
      expect(text).not.toMatch(/^\s*(ARG|FROM)\s+[^\n]*\bcaddy:/m);
      expect(text).not.toMatch(/CADDY_IMAGE/);
      for (const stage of stages) expect(stage.image).not.toMatch(/(^|\/)caddy:/);
    });

    it('compiles Caddy in an official Go (Debian) stage pinned by digest', () => {
      const go = stages.find((stage) =>
        /^golang:\S+-bookworm@sha256:[0-9a-f]{64}$/.test(stage.image),
      );
      expect(go, 'a golang:*-bookworm stage pinned by digest').toBeDefined();
      const build = (go?.lines ?? []).join('\n');
      expect(build).toContain('CGO_ENABLED=0');
      expect(build).toContain('-trimpath');
      expect(build).toMatch(/-ldflags\s+"-s -w"/);
      expect(build).toContain('GOARCH=${TARGETARCH}');
      expect(build).toContain('-mod=readonly');
      expect(go?.copies.join('\n')).toContain('deploy/caddy/build');
    });

    it('copies the compiled binary into the final image', () => {
      const final = stages.at(-1);
      expect(final?.copies.join('\n')).toMatch(/--from=\S+\s+\S*caddy\s+\/usr\/bin\/caddy/);
    });

    it('pins Caddy and raises the dependencies above the vulnerable versions', () => {
      expect(atLeast(versionOf('github.com/caddyserver/caddy/v2'), [2, 11, 9])).toBe(true);
      // GO-2026-6860 is fixed in x/net 0.62.0 and GO-2026-6865 in klauspost/compress 1.20.2.
      expect(atLeast(versionOf('golang.org/x/net'), [0, 62, 0])).toBe(true);
      expect(atLeast(versionOf('github.com/klauspost/compress'), [1, 20, 2])).toBe(true);
    });

    it('versions go.sum next to go.mod so the build is reproducible', () => {
      expect(existsSync(resolve(ROOT, 'deploy/caddy/build/go.sum'))).toBe(true);
      expect(read('deploy/caddy/build/main.go')).toContain('modules/standard');
    });

    it('needs no scan exception any more', () => {
      expect(JSON.parse(read('.github/image-scan-exceptions.json'))).toEqual([]);
    });
  });
});

describe('Compose images', () => {
  it.each(COMPOSE_FILES)('%s pins every image by digest', (file) => {
    const images = [...read(file).matchAll(/^\s+image:\s*(\S+)/gm)].map((match) => match[1] ?? '');
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      // `${VAR}` references are resolved at deploy time from digests recorded by the release.
      if (image.includes('${')) continue;
      expect(image, image).toMatch(/@sha256:[0-9a-f]{64}$/);
      expect(image.toLowerCase()).not.toContain('alpine');
    }
  });
});
