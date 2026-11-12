import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSandbox, hasCommand, posix, ROOT, type Sandbox } from '../support/sandbox.ts';

// Starting bash is slow on Windows; the scripts themselves are quick.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

/**
 * F9 (T040, T048, T051, FR-024, FR-025, FR-034): `deploy.sh` keeps the dump and `previous`, runs the
 * migrator before the new services start, and on a failed migration, a broken health check or missing
 * headers it goes back to the previous version by itself and exits with an error; `rollback.sh` goes
 * back to the previous digests and waits for health. The scripts run in a temporary directory with a
 * stub for docker, git and curl: nothing reaches a registry, a VM or the network.
 */
const DEPLOY = 'deploy/ops/deploy.sh';
const ROLLBACK = 'deploy/ops/rollback.sh';
const DOCTOR = 'deploy/ops/doctor.sh';
const HEADERS = 'deploy/ops/check-headers.sh';
const ACCOUNT = 'deploy/ops/create-account.sh';
const LIB = 'deploy/ops/lib.sh';
const SSH_DEPLOY = 'deploy/ops/ssh-deploy.sh';

const SHA1 = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);
const DOMAIN = 'demo.example.test';
const IMAGES = ['api', 'worker', 'edge', 'migrator'];
/** The digest of the index the docker stub serves with `--raw`: the SHA-256 of its exact bytes. */
const stubDigest = (image: string, sha: string): string => {
  const body = `{"stub":"bog.ocir.io/testns/cognitive-dag/${image}:${sha}"}`;
  return `sha256:${createHash('sha256').update(body).digest('hex')}`;
};

const FULL_HEADERS = [
  'HTTP/2 200',
  'strict-transport-security: max-age=31536000; includeSubDomains',
  "content-security-policy: default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; frame-ancestors 'none'",
  'x-frame-options: DENY',
  'x-content-type-options: nosniff',
  'permissions-policy: camera=(), microphone=(), geolocation=()',
  'cross-origin-embedder-policy: require-corp',
  'cross-origin-opener-policy: same-origin',
  'cross-origin-resource-policy: same-origin',
  'referrer-policy: strict-origin-when-cross-origin',
  'content-type: text/html',
  '',
].join('\r\n');

describe('shellcheck', () => {
  it.skipIf(!hasCommand('shellcheck'))('is clean on the operation scripts', () => {
    const files = [
      DEPLOY,
      ROLLBACK,
      DOCTOR,
      HEADERS,
      ACCOUNT,
      LIB,
      SSH_DEPLOY,
      'deploy/ops/alerts.sh',
    ].map((f) => posix(join(ROOT, f)));
    const run = spawnSync('shellcheck', ['-x', ...files], { encoding: 'utf8' });
    expect(run.stdout + run.stderr).toBe('');
    expect(run.status).toBe(0);
  });
});

/** The services with state whose configuration deploy.sh keeps on a stable path (ADR-0100). */
const CONFIG_SERVICES = ['valkey', 'postgres', 'temporal'] as const;
type ConfigService = (typeof CONFIG_SERVICES)[number];

interface ComposeCall {
  args: string;
  sha: string;
  /** Directory and hash of each configuration, as the compose file receives them from the script. */
  config: Record<ConfigService, { dir: string; hash: string }>;
}

describe('deploy scripts (T040)', () => {
  let sandbox: Sandbox;
  const pullToken = randomBytes(18).toString('base64url');

  const dir = (...parts: string[]): string => sandbox.path(...parts);
  const state = (name: string): string => dir('var/lib/cognitive-dag/state', name);
  const readState = (name: string): string =>
    existsSync(state(name)) ? readFileSync(state(name), 'utf8') : '';

  const env = (extra: Record<string, string> = {}): Record<string, string> => ({
    CDAG_ROOT: posix(dir('opt/cognitive-dag')),
    CDAG_STATE: posix(dir('var/lib/cognitive-dag')),
    CDAG_SECRETS: posix(dir('run/cognitive-dag/secrets')),
    CDAG_PKI: posix(dir('run/cognitive-dag/pki')),
    CDAG_CONFIG_DIR: posix(dir('etc/cognitive-dag')),
    DEPLOY_WAIT_TIMEOUT: '5',
    STUB_HEADERS: posix(dir('fixtures/headers.txt')),
    STUB_REDIRECT: posix(dir('fixtures/redirect.txt')),
    STUB_REPO: posix(ROOT),
    ...extra,
  });

  /** The docker stub: logs each compose call with the version in its env files, and fails on demand. */
  const dockerStub = `args=("$@"); envtext=""
for ((i = 0; i < \${#args[@]}; i++)); do
  if [[ "\${args[i]}" == --env-file ]]; then envtext+="$(cat "\${args[i + 1]}" 2>/dev/null)"$'\\n'; fi
done
sha="$(grep -h '^GIT_SHA=' <<<"$envtext" | tail -n 1 | cut -d= -f2 || true)"
printf '  env %s\\n' "$sha" >>"$STUB_LOG"
printf '  cfg %s %s %s %s %s %s\\n' "$VALKEY_CONFIG_DIR" "$VALKEY_CONFIG_HASH" "$POSTGRES_CONFIG_DIR" "$POSTGRES_CONFIG_HASH" "$TEMPORAL_CONFIG_DIR" "$TEMPORAL_CONFIG_HASH" >>"$STUB_LOG"
cmd="$*"
if [[ -n "\${STUB_FAIL_CMD:-}" && "$cmd" == *"$STUB_FAIL_CMD"* && "$sha" == "\${STUB_FAIL_SHA:-}" ]]; then
  echo "stub failure" >&2; exit 1
fi
case "$cmd" in
  *"buildx imagetools inspect"*)
    # Like buildx 0.30.1: --format is ignored for an index, only --raw gives the index itself.
    ref="\${args[-1]}"; image="\${ref##*/}"; image="\${image%%:*}"
    if [[ -n "\${STUB_INSPECT_FAIL:-}" && "$image" == "$STUB_INSPECT_FAIL" ]]; then
      echo "ERROR: $ref: not found" >&2; exit 1
    fi
    if [[ "$cmd" == *" --raw "* ]]; then
      [[ -n "\${STUB_INSPECT_EMPTY:-}" ]] || printf '{"stub":"%s"}' "$ref"
    else
      printf 'Name:      %s\\nMediaType: application/vnd.oci.image.index.v1+json\\nDigest:    sha256:fc31d0034acf\\n\\nManifests:\\n' "$ref"
    fi ;;
  *"ps --services --status running"*) [[ -z "\${STUB_POSTGRES_RUNNING:-}" ]] || echo postgres ;;
  *pg_dump*) echo "DUMP-CONTENT" ;;
  *"login"*) cat >/dev/null ;;
esac`;

  beforeEach(() => {
    sandbox = createSandbox();
    mkdirSync(dir('opt/cognitive-dag/deploy'), { recursive: true });
    writeFileSync(dir('opt/cognitive-dag/deploy/compose.prod.yaml'), 'name: cognitive-dag-prod\n');
    mkdirSync(dir('etc/cognitive-dag'), { recursive: true });
    writeFileSync(
      dir('etc/cognitive-dag/cognitive-dag.env'),
      [
        'OCIR_REGISTRY=bog.ocir.io',
        'OCIR_NAMESPACE=testns',
        'OCIR_PULL_USER=testns/Default/pull-user',
        'SMTP_HOST=smtp.example.test',
        '',
      ].join('\n'),
    );
    writeFileSync(dir('etc/cognitive-dag/local.env'), `SITE_DOMAIN=${DOMAIN}\n`);
    mkdirSync(dir('run/cognitive-dag/secrets'), { recursive: true });
    writeFileSync(
      dir('run/cognitive-dag/secrets/postgres_superuser_password'),
      randomBytes(9).toString('hex'),
    );
    writeFileSync(dir('run/cognitive-dag/secrets/ocir_pull_token'), pullToken);
    mkdirSync(dir('run/cognitive-dag/pki'), { recursive: true });
    mkdirSync(dir('var/lib/cognitive-dag/state'), { recursive: true });
    mkdirSync(dir('var/lib/cognitive-dag/dumps'), { recursive: true });
    mkdirSync(dir('fixtures'), { recursive: true });
    writeFileSync(dir('fixtures/headers.txt'), FULL_HEADERS);
    writeFileSync(dir('fixtures/redirect.txt'), `301 https://${DOMAIN}/`);
    sandbox.stub('docker', dockerStub);
    sandbox.stub(
      'git',
      `if [[ " $* " == *" merge-base "* && -n "\${STUB_NOT_ANCESTOR:-}" ]]; then exit 1; fi
if [[ " $* " == *" archive "* ]]; then tar -c -C "$STUB_REPO" deploy; fi`,
    );
    sandbox.stub(
      'curl',
      `if [[ " $* " == *" -D "* ]]; then cat "$STUB_HEADERS"; elif [[ " $* " == *" -w "* ]]; then cat "$STUB_REDIRECT"; fi`,
    );
  });
  afterEach(() => sandbox.cleanup());

  /** Compose calls in order, each with the version (GIT_SHA) of its env files. */
  function composeCalls(): ComposeCall[] {
    const lines = readFileSync(sandbox.log, 'utf8').split('\n');
    const calls: ComposeCall[] = [];
    lines.forEach((line, index) => {
      if (!line.startsWith('docker compose')) return;
      const sha = /^ {2}env (\S*)/.exec(lines[index + 1] ?? '')?.[1] ?? '';
      const cfg = /^ {2}cfg (.*)$/.exec(lines[index + 2] ?? '')?.[1]?.split(' ') ?? [];
      const config = Object.fromEntries(
        CONFIG_SERVICES.map((svc, i) => [
          svc,
          { dir: cfg[i * 2] ?? '', hash: cfg[i * 2 + 1] ?? '' },
        ]),
      ) as ComposeCall['config'];
      calls.push({ args: line, sha, config });
    });
    return calls;
  }
  const finalUps = (sha: string): ComposeCall[] =>
    composeCalls().filter((call) => call.sha === sha && call.args.includes('--remove-orphans'));
  const index = (calls: string[], pattern: RegExp): number =>
    calls.findIndex((c) => pattern.test(c));

  const deploy = (sha: string, extra: Record<string, string> = {}) =>
    sandbox.run(DEPLOY, [sha], env(extra));

  describe('deploy.sh', () => {
    it('refuses anything that is not a full commit SHA before touching docker', () => {
      for (const bad of ['', 'main', 'abc', `${SHA1};rm -rf /`, SHA1.toUpperCase()]) {
        const result = sandbox.run(DEPLOY, bad === '' ? [] : [bad], env());
        expect(result.status, bad).toBe(2);
      }
      expect(sandbox.calls().filter((call) => call.startsWith('docker'))).toEqual([]);
    });

    it('refuses a commit that is not on main', () => {
      const result = deploy(SHA1, { STUB_NOT_ANCESTOR: '1' });
      expect(result.status).not.toBe(0);
      expect(result.output).toMatch(/main/);
      expect(composeCalls()).toEqual([]);
    });

    it('refuses to run without the secrets on the tmpfs', () => {
      rmSync(dir('run/cognitive-dag/secrets'), { recursive: true });
      const result = deploy(SHA1);
      expect(result.status).not.toBe(0);
      expect(result.output).toMatch(/secrets/);
      expect(composeCalls()).toEqual([]);
    });

    it('deploys a first version: digests by SHA, migrator, then the services, then the headers', () => {
      const result = deploy(SHA1);
      expect(result.status, result.output).toBe(0);
      const calls = sandbox.calls();
      // Images are resolved by digest from the registry and never used by a moving tag.
      const inspects = calls.filter((call) => call.includes('imagetools inspect'));
      expect(inspects).toHaveLength(IMAGES.length);
      for (const image of IMAGES) {
        expect(inspects.join('\n')).toContain(`bog.ocir.io/testns/cognitive-dag/${image}:${SHA1}`);
      }
      const current = readState('current.env');
      for (const image of IMAGES) {
        expect(current).toMatch(
          new RegExp(
            `^${image.toUpperCase()}_IMAGE=bog\\.ocir\\.io/testns/cognitive-dag/${image}@sha256:[0-9a-f]{64}$`,
            'm',
          ),
        );
      }
      for (const image of IMAGES) {
        expect(current).toContain(
          `${image.toUpperCase()}_IMAGE=bog.ocir.io/testns/cognitive-dag/${image}@${stubDigest(image, SHA1)}\n`,
        );
      }
      expect(current).toContain(`GIT_SHA=${SHA1}`);
      expect(readState('previous.env')).toBe('');

      const login = index(
        calls,
        /^docker login bog\.ocir\.io --username testns\/Default\/pull-user --password-stdin$/,
      );
      const migrate = index(calls, /^docker compose .* run --rm migrator/);
      const up = index(calls, /^docker compose .* up -d --wait .*--remove-orphans/);
      const headers = index(calls, /^curl .*https:\/\/demo\.example\.test\//);
      expect(login).toBeGreaterThanOrEqual(0);
      expect(migrate).toBeGreaterThan(login);
      expect(up).toBeGreaterThan(migrate);
      expect(headers).toBeGreaterThan(up);
      // No dump on a first deploy: there is no database yet.
      expect(calls.join('\n')).not.toMatch(/pg_dump/);
    });

    it.each([
      ['fails', { STUB_INSPECT_FAIL: 'worker' }],
      ['is empty', { STUB_INSPECT_EMPTY: '1' }],
    ])('stops before the dump and any service when resolving an image %s', (_name, extra) => {
      expect(deploy(SHA1).status).toBe(0);
      const before = readState('current.env');
      sandbox.clearCalls();

      const result = deploy(SHA2, { STUB_POSTGRES_RUNNING: '1', ...extra });
      expect(result.status).not.toBe(0);
      expect(result.output).toMatch(/cannot resolve/);
      expect(existsSync(state('candidate.env'))).toBe(false);
      expect(readdirSync(dir('var/lib/cognitive-dag/dumps'))).toEqual([]);
      expect(sandbox.calls().join('\n')).not.toMatch(/pg_dump/);
      expect(composeCalls()).toEqual([]);
      expect(readState('current.env')).toBe(before);
    });

    it('keeps the dump and previous, runs migrator after the dump and before the new services', () => {
      expect(deploy(SHA1).status).toBe(0);
      const oldCurrent = readState('current.env');
      const dumps = dir('var/lib/cognitive-dag/dumps');
      for (const stamp of ['20200101T000000Z', '20200102T000000Z', '20200103T000000Z']) {
        writeFileSync(join(dumps, `predeploy-${stamp}-none.dump`), 'old');
      }
      sandbox.clearCalls();

      const result = deploy(SHA2, { STUB_POSTGRES_RUNNING: '1' });
      expect(result.status, result.output).toBe(0);
      const calls = sandbox.calls();
      const dump = index(calls, /pg_dump/);
      const migrate = index(calls, /run --rm migrator/);
      const up = index(calls, /--remove-orphans/);
      expect(dump).toBeGreaterThanOrEqual(0);
      expect(migrate).toBeGreaterThan(dump);
      expect(up).toBeGreaterThan(migrate);

      expect(readState('previous.env')).toBe(oldCurrent);
      expect(readState('current.env')).toContain(`GIT_SHA=${SHA2}`);
      // The new dump holds the output of pg_dump, and only the last three dumps stay (FR-025).
      const kept = readdirSync(dumps)
        .filter((name) => name.startsWith('predeploy-'))
        .sort();
      expect(kept).toHaveLength(3);
      expect(kept.some((name) => name.includes(`-${SHA1}`))).toBe(true);
      expect(kept.some((name) => name.includes('20200101'))).toBe(false);
      const fresh = kept.find((name) => name.includes(`-${SHA1}`)) ?? '';
      expect(readFileSync(join(dumps, fresh), 'utf8')).toContain('DUMP-CONTENT');
    });

    it('on a failed migration goes back by itself, exits with an error and starts nothing new', () => {
      expect(deploy(SHA1).status).toBe(0);
      const before = readState('current.env');
      sandbox.clearCalls();

      const result = deploy(SHA2, {
        STUB_POSTGRES_RUNNING: '1',
        STUB_FAIL_CMD: 'run --rm migrator',
        STUB_FAIL_SHA: SHA2,
      });
      expect(result.status).not.toBe(0);
      expect(result.output).toMatch(/migrat/i);
      expect(finalUps(SHA2)).toEqual([]);
      // The previous version is brought up again and the state is untouched.
      const restore = finalUps(SHA1);
      expect(restore.length).toBeGreaterThan(0);
      expect(restore.at(-1)?.args).toContain('--wait');
      expect(readState('current.env')).toBe(before);
    });

    it('on a failed health check goes back by itself and exits with an error', () => {
      expect(deploy(SHA1).status).toBe(0);
      sandbox.clearCalls();
      const result = deploy(SHA2, {
        STUB_POSTGRES_RUNNING: '1',
        STUB_FAIL_CMD: '--remove-orphans',
        STUB_FAIL_SHA: SHA2,
      });
      expect(result.status).not.toBe(0);
      expect(result.output).toMatch(/rolled back|rolling back/i);
      expect(composeCalls().at(-1)?.sha).toBe(SHA1);
      expect(readState('current.env')).toContain(`GIT_SHA=${SHA1}`);
      expect(readState('previous.env')).toBe('');
    });

    it('on missing headers goes back by itself and names the missing header', () => {
      expect(deploy(SHA1).status).toBe(0);
      sandbox.clearCalls();
      writeFileSync(
        dir('fixtures/headers.txt'),
        FULL_HEADERS.replace(/strict-transport-security[^\r]*\r\n/, ''),
      );
      const result = deploy(SHA2, { STUB_POSTGRES_RUNNING: '1' });
      expect(result.status).not.toBe(0);
      expect(result.output.toLowerCase()).toContain('strict-transport-security');
      expect(composeCalls().at(-1)?.sha).toBe(SHA1);
      expect(readState('current.env')).toContain(`GIT_SHA=${SHA1}`);
    });

    it('on a failed first deploy stops the public services: there is nothing to go back to', () => {
      const result = deploy(SHA1, { STUB_FAIL_CMD: '--remove-orphans', STUB_FAIL_SHA: SHA1 });
      expect(result.status).not.toBe(0);
      expect(sandbox.calls().join('\n')).toMatch(/compose .* stop edge api worker/);
      expect(readState('current.env')).toBe('');
    });

    it('never prints the registry token and sends it to docker login by stdin only', () => {
      const result = deploy(SHA1);
      expect(result.status, result.output).toBe(0);
      expect(result.output).not.toContain(pullToken);
      expect(readFileSync(sandbox.log, 'utf8')).not.toContain(pullToken);
    });

    it.skipIf(process.platform === 'win32')(
      'rejects a second deploy while another one holds the lock',
      () => {
        mkdirSync(dir('var/lib/cognitive-dag/state/deploy.lock'));
        writeFileSync(dir('var/lib/cognitive-dag/state/deploy.lock/pid'), String(process.pid));
        const result = deploy(SHA1);
        expect(result.status).not.toBe(0);
        expect(result.output).toMatch(/lock|another deploy/i);
        expect(composeCalls()).toEqual([]);
      },
    );

    it('--resume starts the current version without migrating or pulling', () => {
      expect(deploy(SHA1).status).toBe(0);
      sandbox.clearCalls();
      const result = sandbox.run(DEPLOY, ['--resume'], env());
      expect(result.status, result.output).toBe(0);
      const calls = composeCalls();
      expect(calls.every((call) => call.sha === SHA1)).toBe(true);
      expect(calls.map((call) => call.args).join('\n')).not.toMatch(/migrator|pull/);
      expect(calls.some((call) => call.args.includes('up -d --wait'))).toBe(true);
    });
  });

  describe('release export (the checkout is never moved)', () => {
    const release = (sha: string): string => state(`releases/${sha}/deploy/compose.prod.yaml`);
    const composeFiles = (sha: string): string[] =>
      composeCalls()
        .filter((call) => call.sha === sha)
        .map((call) => / -f (\S+)/.exec(call.args)?.[1] ?? '');

    it('exports the commit and runs compose from that export, never from the checkout', () => {
      const result = deploy(SHA1);
      expect(result.status, result.output).toBe(0);
      expect(existsSync(release(SHA1))).toBe(true);
      expect(existsSync(state(`releases/${SHA1}/deploy/ops/deploy.sh`))).toBe(true);
      const files = composeFiles(SHA1);
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) expect(file).toBe(posix(release(SHA1)));
      const git = sandbox.calls().filter((call) => call.startsWith('git'));
      expect(git.some((call) => call.includes(`archive ${SHA1} deploy`))).toBe(true);
    });

    it('never checks out, resets or moves the checkout it deploys from', () => {
      expect(deploy(SHA1).status).toBe(0);
      expect(deploy(SHA2).status).toBe(0);
      const git = sandbox.calls().filter((call) => call.startsWith('git'));
      expect(git.length).toBeGreaterThan(0);
      for (const call of git) expect(call).not.toMatch(/ (checkout|switch|reset|pull|merge) /);
    });

    it('keeps the exports of the current and the previous version only', () => {
      expect(deploy(SHA1).status).toBe(0);
      expect(deploy(SHA2).status).toBe(0);
      expect(deploy('c'.repeat(40)).status).toBe(0);
      expect(readdirSync(state('releases')).sort()).toEqual([SHA2, 'c'.repeat(40)].sort());
    });

    it('rollback and compose.sh use the compose file of the version they run', () => {
      expect(deploy(SHA1).status).toBe(0);
      expect(deploy(SHA2).status).toBe(0);
      sandbox.clearCalls();
      const result = sandbox.run(ROLLBACK, [], env());
      expect(result.status, result.output).toBe(0);
      const files = composeFiles(SHA1);
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) expect(file).toBe(posix(release(SHA1)));
    });

    it.skipIf(process.platform === 'win32')('exports files the container users can read', () => {
      expect(deploy(SHA1).status).toBe(0);
      const out = spawnSync('find', [posix(state(`releases/${SHA1}`)), '!', '-perm', '-o=r'], {
        encoding: 'utf8',
      });
      expect(out.stdout).toBe('');
    });
  });

  describe('stable service configuration (ADR-0100)', () => {
    const lastUp = (sha: string): ComposeCall => {
      const ups = finalUps(sha);
      expect(ups.length, `final up of ${sha}`).toBeGreaterThan(0);
      return ups[ups.length - 1] as ComposeCall;
    };
    const installed = (svc: string, file: string): string =>
      readFileSync(dir('var/lib/cognitive-dag/config', svc, file), 'utf8');
    /** A copy of the repository's deploy/ whose valkey.conf differs: the commit the git stub exports. */
    function changedRepo(): string {
      const repo = dir('repo-changed');
      mkdirSync(repo, { recursive: true });
      cpSync(join(ROOT, 'deploy'), join(repo, 'deploy'), { recursive: true });
      appendFileSync(join(repo, 'deploy/valkey/valkey.conf'), '\n# changed for the test\n');
      return posix(repo);
    }

    it('gives valkey, postgres and temporal the same mount path and hash on two deploys with the same configuration', () => {
      expect(deploy(SHA1).status).toBe(0);
      expect(deploy(SHA2).status).toBe(0);
      const first = lastUp(SHA1).config;
      const second = lastUp(SHA2).config;
      for (const svc of CONFIG_SERVICES) {
        expect(first[svc].dir, svc).toBe(posix(dir('var/lib/cognitive-dag/config', svc)));
        expect(first[svc].dir, svc).not.toContain(SHA1);
        expect(first[svc].hash, svc).toMatch(/^[0-9a-f]{64}$/);
        expect(second[svc], svc).toEqual(first[svc]);
      }
      expect(installed('valkey', 'valkey.conf')).toBe(
        readFileSync(join(ROOT, 'deploy/valkey/valkey.conf'), 'utf8'),
      );
      expect(existsSync(dir('var/lib/cognitive-dag/config/postgres/initdb/10-roles.sh'))).toBe(
        true,
      );
      // Nothing is left half copied beside the directories.
      expect(readdirSync(dir('var/lib/cognitive-dag/config')).sort()).toEqual(
        [...CONFIG_SERVICES].sort(),
      );
    });

    it('changes only the hash of the service whose configuration changed', () => {
      expect(deploy(SHA1).status).toBe(0);
      const before = lastUp(SHA1).config;
      sandbox.clearCalls();
      expect(deploy(SHA2, { STUB_REPO: changedRepo() }).status).toBe(0);
      const after = lastUp(SHA2).config;
      expect(after.valkey.hash).not.toBe(before.valkey.hash);
      expect(after.postgres).toEqual(before.postgres);
      expect(after.temporal).toEqual(before.temporal);
      expect(after.valkey.dir).toBe(before.valkey.dir);
      expect(installed('valkey', 'valkey.conf')).toContain('# changed for the test');
    });

    it('rollback puts back the configuration and the hash of the version it returns to', () => {
      expect(deploy(SHA1).status).toBe(0);
      const original = lastUp(SHA1).config.valkey.hash;
      expect(deploy(SHA2, { STUB_REPO: changedRepo() }).status).toBe(0);
      expect(lastUp(SHA2).config.valkey.hash).not.toBe(original);
      sandbox.clearCalls();
      const result = sandbox.run(ROLLBACK, [], env());
      expect(result.status, result.output).toBe(0);
      expect(lastUp(SHA1).config.valkey.hash).toBe(original);
      expect(installed('valkey', 'valkey.conf')).not.toContain('# changed for the test');
    });

    it('a deploy that fails goes back with the configuration and the hash it had', () => {
      expect(deploy(SHA1).status).toBe(0);
      const original = lastUp(SHA1).config.valkey.hash;
      sandbox.clearCalls();
      const result = deploy(SHA2, {
        STUB_REPO: changedRepo(),
        STUB_POSTGRES_RUNNING: '1',
        STUB_FAIL_CMD: '--remove-orphans',
        STUB_FAIL_SHA: SHA2,
      });
      expect(result.status).not.toBe(0);
      expect(lastUp(SHA1).config.valkey.hash).toBe(original);
      expect(installed('valkey', 'valkey.conf')).not.toContain('# changed for the test');
    });

    it('--resume installs the configuration of the current version before it starts it', () => {
      expect(deploy(SHA1).status).toBe(0);
      const original = lastUp(SHA1).config;
      rmSync(dir('var/lib/cognitive-dag/config'), { recursive: true });
      sandbox.clearCalls();
      const result = sandbox.run(DEPLOY, ['--resume'], env());
      expect(result.status, result.output).toBe(0);
      const resumed = composeCalls().at(-1) as ComposeCall;
      expect(resumed.config).toEqual(original);
    });

    it.skipIf(process.platform === 'win32')('installs files the container users can read', () => {
      expect(deploy(SHA1).status).toBe(0);
      const out = spawnSync(
        'find',
        [posix(dir('var/lib/cognitive-dag/config')), '!', '-perm', '-o=r'],
        { encoding: 'utf8' },
      );
      expect(out.stdout).toBe('');
    });
  });

  describe('rollback.sh', () => {
    function twoVersions(): void {
      expect(deploy(SHA1).status).toBe(0);
      expect(deploy(SHA2, { STUB_POSTGRES_RUNNING: '1' }).status).toBe(0);
      sandbox.clearCalls();
    }

    it('goes back to the previous digests, waits for health and swaps current and previous', () => {
      twoVersions();
      const was = { current: readState('current.env'), previous: readState('previous.env') };
      const result = sandbox.run(ROLLBACK, [], env());
      expect(result.status, result.output).toBe(0);
      const ups = composeCalls().filter((call) => call.args.includes('up -d --wait'));
      expect(ups.length).toBeGreaterThan(0);
      expect(ups.every((call) => call.sha === SHA1)).toBe(true);
      // The previous images, by digest, come from the state and not from the registry.
      expect(sandbox.calls().filter((call) => call.includes('imagetools'))).toEqual([]);
      expect(sandbox.calls().join('\n')).toMatch(/curl .*https:\/\/demo\.example\.test\//);
      expect(readState('current.env')).toBe(was.previous);
      expect(readState('previous.env')).toBe(was.current);
      // Migrations are never run backwards.
      expect(sandbox.calls().join('\n')).not.toMatch(/migrator/);
    });

    it('fails and changes nothing when there is no previous version', () => {
      expect(deploy(SHA1).status).toBe(0);
      const before = readState('current.env');
      const result = sandbox.run(ROLLBACK, [], env());
      expect(result.status).not.toBe(0);
      expect(result.output).toMatch(/previous/);
      expect(readState('current.env')).toBe(before);
    });

    it('fails and keeps the state when the previous version does not become healthy', () => {
      twoVersions();
      const before = readState('current.env');
      const result = sandbox.run(
        ROLLBACK,
        [],
        env({ STUB_FAIL_CMD: '--remove-orphans', STUB_FAIL_SHA: SHA1 }),
      );
      expect(result.status).not.toBe(0);
      expect(readState('current.env')).toBe(before);
    });
  });

  describe('check-headers.sh (T048)', () => {
    const check = (extra: Record<string, string> = {}) =>
      sandbox.run(HEADERS, [DOMAIN], env(extra));

    it('passes with the whole header set and the HTTP redirect', () => {
      const result = check();
      expect(result.status, result.output).toBe(0);
    });

    it.each([
      'strict-transport-security',
      'content-security-policy',
      'x-frame-options',
      'x-content-type-options',
      'permissions-policy',
      'cross-origin-embedder-policy',
      'cross-origin-opener-policy',
      'cross-origin-resource-policy',
    ])('fails and names the header when %s is missing', (header) => {
      writeFileSync(
        dir('fixtures/headers.txt'),
        FULL_HEADERS.replace(new RegExp(`${header}[^\\r]*\\r\\n`), ''),
      );
      const result = check();
      expect(result.status).not.toBe(0);
      expect(result.output.toLowerCase()).toContain(header);
    });

    it('fails when the CSP allows inline scripts or framing', () => {
      writeFileSync(
        dir('fixtures/headers.txt'),
        FULL_HEADERS.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
      );
      expect(check().status).not.toBe(0);
      writeFileSync(
        dir('fixtures/headers.txt'),
        FULL_HEADERS.replace("frame-ancestors 'none'", 'frame-ancestors *'),
      );
      expect(check().status).not.toBe(0);
    });

    it('fails when a header has the wrong value', () => {
      writeFileSync(
        dir('fixtures/headers.txt'),
        FULL_HEADERS.replace('x-frame-options: DENY', 'x-frame-options: SAMEORIGIN'),
      );
      expect(check().status).not.toBe(0);
    });

    it('fails when HTTP is not redirected to HTTPS', () => {
      writeFileSync(dir('fixtures/redirect.txt'), '200 ');
      const result = check();
      expect(result.status).not.toBe(0);
      expect(result.output).toMatch(/redirect/i);
      writeFileSync(dir('fixtures/redirect.txt'), '302 https://demo.example.test/');
      expect(check().status).not.toBe(0);
    });

    it('fails when the server answers with an error', () => {
      writeFileSync(dir('fixtures/headers.txt'), FULL_HEADERS.replace('HTTP/2 200', 'HTTP/2 502'));
      expect(check().status).not.toBe(0);
    });

    it('needs a domain', () => {
      expect(sandbox.run(HEADERS, [], env({ SITE_DOMAIN: '' })).status).not.toBe(0);
    });
  });

  describe('doctor.sh', () => {
    it('reports the running version and fails when the secrets are not on the tmpfs', () => {
      expect(deploy(SHA1).status).toBe(0);
      sandbox.stub(
        'stat',
        'if [[ "$1" == "-f" ]]; then echo tmpfs; else exec /usr/bin/stat "$@"; fi',
      );
      const ok = sandbox.run(DOCTOR, [], env());
      expect(ok.output).toContain(SHA1);
      expect(ok.output).not.toContain(pullToken);
      rmSync(dir('run/cognitive-dag/secrets'), { recursive: true });
      const missing = sandbox.run(DOCTOR, [], env());
      expect(missing.status).not.toBe(0);
    });
  });

  describe('ssh-deploy.sh (T047, forced command of the deploy key)', () => {
    const ask = (command: string | undefined) =>
      sandbox.run(
        SSH_DEPLOY,
        [],
        env(command === undefined ? {} : { SSH_ORIGINAL_COMMAND: command }),
      );

    it.each([
      undefined,
      '',
      'bash',
      'deploy',
      `deploy ${SHA1};id`,
      `deploy main`,
      `deploy ${SHA1.toUpperCase()}`,
      `deploy ${SHA1} extra`,
      `rollback`,
    ])('refuses %j before touching anything', (command) => {
      const result = ask(command);
      expect(result.status).toBe(2);
      expect(result.output).toMatch(/refused/);
      expect(sandbox.calls()).toEqual([]);
    });

    it('runs deploy.sh with the SHA and nothing else', () => {
      rmSync(dir('etc/cognitive-dag/local.env'));
      const result = ask(`deploy ${SHA1}`);
      // deploy.sh was reached: it stops at the missing configuration of this empty sandbox.
      expect(result.status).toBe(1);
      expect(result.output).toMatch(/missing .*local\.env/);
    });
  });

  describe('create-account.sh (T051, D23A)', () => {
    const accountStub = `cat >"$STUB_STDIN"; printf '%s\\n' "\${STUB_API_STATUS:-202}"`;
    const run = (args: string[], password: string, extra: Record<string, string> = {}) => {
      sandbox.stub('docker', `if [[ " $* " == *" exec "* ]]; then ${accountStub}; fi`);
      return sandbox.run(
        ACCOUNT,
        args,
        env({ STUB_STDIN: posix(dir('stdin.txt')), ...extra }),
        `${password}\n`,
      );
    };

    it('registers through the API inside the stack, password by stdin and never as an argument', () => {
      const password = randomBytes(12).toString('base64url');
      const result = run(['someone@example.test', 'Alguien'], password);
      expect(result.status, result.output).toBe(0);
      expect(result.output).not.toContain(password);
      expect(sandbox.calls().join('\n')).not.toContain(password);
      const sent = readFileSync(dir('stdin.txt'), 'utf8');
      expect(sent).toContain(password);
      expect(sent).toContain('someone@example.test');
      expect(sandbox.calls().join('\n')).toMatch(/compose .* exec -T api node/);
    });

    it('fails when the API refuses the data', () => {
      const result = run(['someone@example.test', 'Alguien'], 'x', { STUB_API_STATUS: '422' });
      expect(result.status).not.toBe(0);
    });

    it('rejects an address that is not an email and an empty password', () => {
      expect(run(['not an email', 'X'], 'secret-value-123').status).not.toBe(0);
      expect(run(['someone@example.test', 'X'], '').status).not.toBe(0);
    });
  });
});
