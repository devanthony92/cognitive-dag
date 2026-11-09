import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * F9 (FR-022, FR-023, D3C): `ci.yml` keeps read-only permissions and its 6 required checks; the
 * publication permission and the registry secrets live only in `release.yml`, in the job that
 * publishes, and every action is pinned by commit SHA. There is no YAML parser in the workspace, so
 * the workflow layout is read from its indentation (two spaces per level, as Prettier writes it).
 */
const ROOT = resolve(import.meta.dirname, '../../..');
const WORKFLOWS_DIR = resolve(ROOT, '.github/workflows');
const read = (file: string): string => readFileSync(resolve(WORKFLOWS_DIR, file), 'utf8');
const files = readdirSync(WORKFLOWS_DIR).filter((file) => /\.ya?ml$/.test(file));

/** The text of every job under `jobs:`, keyed by job id. */
function jobs(source: string): Map<string, string> {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  const result = new Map<string, string>();
  if (start < 0) return result;
  let id: string | undefined;
  let body: string[] = [];
  const flush = () => {
    if (id) result.set(id, body.join('\n'));
  };
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const header = /^ {2}([\w-]+):\s*$/.exec(line);
    if (header) {
      flush();
      id = header[1];
      body = [];
    } else body.push(line);
  }
  flush();
  return result;
}

/** The top-level `permissions:` block (everything indented under it). */
function topPermissions(source: string): string[] {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => /^permissions:/.test(line));
  if (start < 0) return [];
  const inline = /^permissions:\s*(\S.*)$/.exec(lines[start] ?? '')?.[1];
  if (inline) return [inline];
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(line)) break;
    block.push(line.trim());
  }
  return block;
}

describe('ci.yml', () => {
  const ci = read('ci.yml');

  it('keeps contents: read as its only permission', () => {
    expect(topPermissions(ci)).toEqual(['contents: read']);
  });

  it('declares no write permission, id-token or registry secret anywhere', () => {
    expect(ci).not.toMatch(/:\s*write\b/);
    expect(ci).not.toContain('id-token');
    expect(ci).not.toMatch(/secrets\./);
    expect(ci).not.toMatch(/OCIR/);
    expect(ci).not.toMatch(/environment:/);
  });

  it('keeps the four jobs behind the 6 required checks', () => {
    const ids = [...jobs(ci).keys()];
    expect(ids).toEqual(['quality', 'security', 'integration', 'images']);
    // integration and images run on amd64 and arm64: 1 + 1 + 2 + 2 = 6 checks.
    for (const id of ['integration', 'images']) {
      const body = jobs(ci).get(id) ?? '';
      expect(body).toContain('arch: amd64');
      expect(body).toContain('arch: arm64');
    }
  });

  it('runs shellcheck inside the quality job and adds no job (D16A)', () => {
    expect(jobs(ci).get('quality')).toMatch(/shellcheck/);
    expect(jobs(ci).size).toBe(4);
  });
});

describe('release.yml', () => {
  const release = read('release.yml');
  const releaseJobs = jobs(release);
  // The publish job delegates to this script, so what it does counts as part of the workflow.
  const script = readFileSync(resolve(ROOT, 'scripts/ci/publish-image.sh'), 'utf8');
  const releaseAndScript = `${release}
${script}`;

  it('runs only on push to main', () => {
    const on = /^on:\s*\n((?: {2}.*\n?)+)/m.exec(release)?.[1] ?? '';
    expect(on).toMatch(/push:/);
    expect(on).toMatch(/branches:\s*\[main\]/);
    expect(on).not.toMatch(/pull_request|workflow_dispatch|schedule|workflow_run/);
  });

  it('sets no workflow-wide permission beyond read-only', () => {
    const top = topPermissions(release);
    expect(top.length).toBeGreaterThan(0);
    for (const line of top) expect(line).toMatch(/^(\{\}|contents: read)$/);
  });

  it('declares permissions in every job', () => {
    expect(releaseJobs.size).toBeGreaterThan(0);
    for (const [id, body] of releaseJobs) {
      expect(body, `job ${id}`).toMatch(/^ {4}permissions:/m);
    }
  });

  it('never grants more than contents: read', () => {
    expect(release).not.toMatch(/(packages|id-token|actions|attestations|deployments):\s*write/);
  });

  it('builds arm64 on the native runner and never uses QEMU', () => {
    expect(release).toContain('ubuntu-24.04-arm');
    expect(release).not.toMatch(/qemu/i);
    expect(release).not.toContain('setup-qemu-action');
  });

  it('builds the four images', () => {
    for (const image of ['api', 'worker', 'edge', 'migrator']) {
      expect(release, image).toContain(image);
    }
    expect(release).toContain('apps/api/Dockerfile');
    expect(release).toContain('apps/worker/Dockerfile');
    expect(release).toContain('apps/web/Dockerfile');
    expect(release).toContain('packages/db/Dockerfile');
  });

  it('reads the registry and namespace from variables, never as literals', () => {
    expect(release).toContain('vars.OCIR_REGISTRY');
    expect(release).toContain('vars.OCIR_NAMESPACE');
    expect(release).not.toMatch(/\.ocir\.io/);
    expect(release).not.toMatch(/axnl7/);
  });

  it('tags with the commit SHA and publishes by digest', () => {
    expect(release).toContain('GIT_SHA: ${{ github.sha }}');
    expect(script).toMatch(/GIT_SHA/);
    expect(script).toMatch(/CRANE.*digest/s);
    expect(script).toMatch(/index append/);
  });

  it('scans before pushing and attaches a CycloneDX SBOM', () => {
    expect(script).toMatch(/grype/);
    expect(script).toMatch(/cyclonedx/i);
    expect(script).toMatch(/oras.*attach/s);
    expect(script).toContain('check-image-scan');
    // The scan step comes before the first push.
    expect(script.indexOf('check-image-scan')).toBeLessThan(script.indexOf('"${CRANE}" push'));
  });

  it('pins the tool images in the publish script by digest', () => {
    const tools = [...script.matchAll(/^(GRYPE|SYFT|CRANE|ORAS)='([^']+)'/gm)];
    expect(tools).toHaveLength(4);
    for (const tool of tools) expect(tool[2]).toMatch(/@sha256:[0-9a-f]{64}$/);
  });

  it('keeps the registry secrets in the publish job, behind the production environment', () => {
    const holders = [...releaseJobs].filter(([, body]) => /OCIR_(USERNAME|TOKEN)/.test(body));
    expect(holders).toHaveLength(1);
    const [id, body] = holders[0] ?? ['', ''];
    expect(id).toMatch(/publish/);
    expect(body).toMatch(/^ {4}environment:\s*production\s*$/m);
    expect(body).toContain('secrets.OCIR_USERNAME');
    expect(body).toContain('secrets.OCIR_TOKEN');
    // No job other than the publish job sees the secrets or the environment.
    for (const [other, text] of releaseJobs) {
      if (other === id) continue;
      expect(text, `job ${other}`).not.toMatch(/secrets\.|environment:/);
    }
  });

  it('never prints a secret', () => {
    expect(releaseAndScript).not.toMatch(/echo\s+.*(OCIR_TOKEN|secrets\.)/);
    expect(releaseAndScript).not.toMatch(/set -[a-z]*x|--debug/);
    expect(releaseAndScript).not.toMatch(/--password(?!-stdin)/);
  });
});

describe('every workflow', () => {
  it('has workflow files to check', () => {
    expect(files).toContain('ci.yml');
    expect(files).toContain('release.yml');
  });

  it.each(files)('%s pins every action by commit SHA', (file) => {
    const uses = [...read(file).matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1] ?? '');
    for (const reference of uses) {
      if (reference.startsWith('./')) continue;
      expect(reference, `${file}: ${reference}`).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
    }
  });

  it('keeps the registry secrets out of every workflow but release.yml', () => {
    for (const file of files) {
      if (file === 'release.yml') continue;
      expect(read(file), file).not.toMatch(/OCIR_(USERNAME|TOKEN)/);
      expect(read(file), file).not.toMatch(/environment:\s*production/);
    }
  });

  it.each(files)('%s names its permissions at the top level', (file) => {
    expect(topPermissions(read(file)).length, file).toBeGreaterThan(0);
  });
});

describe('publish-image.sh containers', () => {
  const script = readFileSync(resolve(ROOT, 'scripts/ci/publish-image.sh'), 'utf8');
  const runs = script.split(/\r?\n/).filter((line) => /\bdocker run\b/.test(line));

  it('runs every tool container as the runner user (crane defaults to uid 65532)', () => {
    expect(runs.length).toBeGreaterThan(0);
    for (const line of runs) expect(line, line).toMatch(/--user\s+"\$\(id -u\):\$\(id -g\)"/);
  });

  it('starts containers only through the run helper and gives them a writable HOME', () => {
    expect(runs).toHaveLength(1);
    expect(script).toMatch(/-e HOME=\/work\//);
  });
});
