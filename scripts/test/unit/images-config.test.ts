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

  it('runs the migrator with the migrations folder and without a server', () => {
    const text = read('packages/db/Dockerfile');
    expect(text).toContain('migrations');
    expect(text).toMatch(/drizzle-kit/);
    expect(text).not.toMatch(/^EXPOSE\s/m);
  });

  it('builds the edge image on the official Caddy image pinned by digest', () => {
    const stages = parse('apps/web/Dockerfile');
    expect(stages.some((stage) => /^caddy:\S+@sha256:[0-9a-f]{64}$/.test(stage.image))).toBe(true);
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
