import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSandbox, hasCommand, posix, ROOT, type Sandbox } from '../support/sandbox.ts';

// Starting bash is slow on Windows; the scripts themselves are quick.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

/**
 * F9 (T039, FR-014, FR-015, FR-016): `provision.sh` is idempotent, prints no value, writes nothing
 * inside the repository tree, and `secrets.sh` leaves the secrets only on a `tmpfs` and fails closed
 * when the Vault does not answer. Every script runs in a temporary directory that stands for `/`,
 * with stub commands for the host tools (apt, systemd, ufw, git, the OCI CLI); the only real
 * tools are bash and openssl. The secrets of the tests are random values made here.
 */
const PROVISION = 'deploy/provision/provision.sh';
const SECRETS = 'deploy/provision/secrets.sh';
const HARDEN = 'deploy/provision/harden.sh';
const FIREWALL = 'deploy/provision/firewall.sh';
const PKI = 'deploy/provision/pki.sh';

const GENERATED = [
  'postgres_superuser_password',
  'app_migrator_password',
  'app_runtime_password',
  'temporal_db_password',
  'valkey_password',
  'credentials_master_key',
];
const DELIVERED = ['gemini_api_key', 'smtp_user', 'smtp_password', 'ocir_pull_token'];
const POSIX_MODES = process.platform !== 'win32';

const random = (): string => randomBytes(18).toString('base64url');
const sha = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Every file under a directory with its content hash: two equal snapshots mean nothing changed. */
function snapshot(directory: string, skip: string[] = []): Record<string, string> {
  const result: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (skip.includes(entry.name)) continue;
      if (entry.isDirectory()) walk(path);
      else result[relative(directory, path)] = sha(path);
    }
  };
  if (existsSync(directory)) walk(directory);
  return result;
}

const provisionEnv = (sandbox: Sandbox): Record<string, string> => ({
  PROVISION_ROOT: posix(sandbox.root),
  CDAG_REPO_URL: 'https://example.invalid/repo.git',
});

/**
 * A small stateful iptables: the rules live in one file as `N <chain>` and `R <chain> <spec>` lines,
 * enough for -N -F -C -A -I -D, iptables-save and iptables-restore --noflush. `netfilter-persistent`
 * is deliberately not stubbed: ufw removes it from the real host, so calling it must fail here too.
 */
const IPTABLES_STATE = 'iptables.rules';
function iptablesStubs(sandbox: Sandbox): void {
  const head = `f="$STUB_BIN/../${IPTABLES_STATE}"; touch "$f"
drop() { awk -v p="$1" 'index($0,p)!=1' "$f" >"$f.t"; mv "$f.t" "$f"; }`;
  sandbox.stub(
    'iptables',
    `${head}
args=(); for a in "$@"; do [[ "$a" == -w ]] || args+=("$a"); done
set -- "\${args[@]}"
op="$1"; chain="\${2:-}"
case "$op" in
  -N) grep -Fxq "N $chain" "$f" && exit 1; echo "N $chain" >>"$f" ;;
  -F) drop "R $chain " ;;
  -C) grep -Fxq "R $chain \${*:3}" "$f" ;;
  -A) echo "R $chain \${*:3}" >>"$f" ;;
  -I) shift 2; [[ "$1" =~ ^[0-9]+$ ]] && shift; { echo "R $chain $*"; cat "$f"; } >"$f.t"; mv "$f.t" "$f" ;;
  -D) line="R $chain \${*:3}"; grep -Fxq "$line" "$f" || exit 1
      awk -v l="$line" '$0==l && !d { d=1; next } { print }' "$f" >"$f.t"; mv "$f.t" "$f" ;;
  *) exit 64 ;;
esac`,
  );
  sandbox.stub(
    'iptables-save',
    `${head}
echo '*filter'
sed -n 's/^N \\(.*\\)$/:\\1 - [0:0]/p; s/^R /-A /p' "$f"
echo COMMIT`,
  );
  sandbox.stub(
    'iptables-restore',
    `${head}
while IFS= read -r line; do
  case "$line" in
    :*) c="\${line%% *}"; c="\${c#:}"; grep -Fxq "N $c" "$f" || echo "N $c" >>"$f"; drop "R $c " ;;
    -A\\ *) echo "R \${line#-A }" >>"$f" ;;
  esac
done`,
  );
}

/** The rules of an Oracle image as the stubs keep them: the generic REJECTs and InstanceServices. */
const ORACLE_RULES = [
  'N InstanceServices',
  'R INPUT -m state --state RELATED,ESTABLISHED -j ACCEPT',
  'R INPUT -p tcp -m state --state NEW -m tcp --dport 22 -j ACCEPT',
  'R INPUT -j REJECT --reject-with icmp-host-prohibited',
  'R FORWARD -j REJECT --reject-with icmp-host-prohibited',
  'R OUTPUT -d 169.254.0.0/16 -j InstanceServices',
  'R InstanceServices -d 169.254.0.2/32 -p tcp -m owner --uid-owner 0 -m tcp --dport 3260 -j ACCEPT',
  'R InstanceServices -d 169.254.0.0/16 -p tcp -j REJECT --reject-with tcp-reset',
];

/** The rules held by the iptables stubs, one per line, sorted so that two runs compare equal. */
const liveRules = (sandbox: Sandbox): string[] =>
  existsSync(sandbox.path(IPTABLES_STATE))
    ? readFileSync(sandbox.path(IPTABLES_STATE), 'utf8').split('\n').filter(Boolean).sort()
    : [];
const seedRules = (sandbox: Sandbox, lines: string[]): void =>
  writeFileSync(sandbox.path(IPTABLES_STATE), `${lines.join('\n')}\n`);

/** Stubs for the host tools that provisioning calls. */
function hostStubs(sandbox: Sandbox): void {
  for (const name of [
    'apt-get',
    'systemctl',
    'ufw',
    'fail2ban-client',
    'sshd',
    'chown',
    'usermod',
  ]) {
    sandbox.stub(name);
  }
  iptablesStubs(sandbox);
  // A user exists once useradd made it: the marker is how the stubs remember between two runs.
  sandbox.stub('useradd', 'mkdir -p "$STUB_BIN/../users"; touch "$STUB_BIN/../users/${!#}"');
  sandbox.stub('id', '[[ -f "$STUB_BIN/../users/${!#}" ]]');
  sandbox.stub(
    'git',
    'for last; do :; done; if [[ " $* " == *" clone "* ]]; then mkdir -p "$last/.git"; fi',
  );
  sandbox.stub(
    'python3',
    `if [[ "$1 $2" == "-m venv" ]]; then
  mkdir -p "$3/bin"
  printf '#!/bin/sh\\nprintf "#!/bin/sh\\\\n" >"$(dirname "$0")/oci"; chmod +x "$(dirname "$0")/oci"\\n' >"$3/bin/pip"
  chmod +x "$3/bin/pip"
fi`,
  );
}

describe('shellcheck', () => {
  it.skipIf(!hasCommand('shellcheck'))('is clean on the provisioning scripts', () => {
    const files = [PROVISION, SECRETS, HARDEN, FIREWALL, PKI].map((file) =>
      posix(join(ROOT, file)),
    );
    const run = spawnSync('shellcheck', files, { encoding: 'utf8' });
    expect(run.stdout + run.stderr).toBe('');
    expect(run.status).toBe(0);
  });
});

describe('provision.sh (T039)', () => {
  let sandbox: Sandbox;
  const canaries: string[] = [];

  beforeEach(() => {
    sandbox = createSandbox();
    hostStubs(sandbox);
    // Secrets that already sit on the tmpfs of the sandbox: provisioning must neither print them
    // nor touch them.
    const dir = sandbox.path('run/cognitive-dag/secrets');
    mkdirSync(dir, { recursive: true });
    canaries.length = 0;
    for (const name of [...GENERATED, ...DELIVERED]) {
      const value = random();
      canaries.push(value);
      writeFileSync(join(dir, name), value);
    }
  });
  afterEach(() => sandbox.cleanup());

  const state = (): Record<string, string> =>
    snapshot(sandbox.root, ['stub-bin', 'calls.log', IPTABLES_STATE]);

  it('succeeds twice and the second run changes nothing (idempotent)', () => {
    const first = sandbox.run(PROVISION, [], provisionEnv(sandbox));
    expect(first.status, first.output).toBe(0);
    const afterFirst = state();
    expect(Object.keys(afterFirst).length).toBeGreaterThan(5);

    sandbox.clearCalls();
    const second = sandbox.run(PROVISION, [], provisionEnv(sandbox));
    expect(second.status, second.output).toBe(0);
    expect(state()).toEqual(afterFirst);

    // What must happen once is not repeated: the user, the clone, the OCI CLI.
    const calls = sandbox.calls();
    expect(calls.filter((call) => call.startsWith('useradd'))).toEqual([]);
    expect(calls.filter((call) => /^git .*clone/.test(call))).toEqual([]);
    expect(calls.filter((call) => /^python3 -m venv/.test(call))).toEqual([]);
  });

  it('prints no secret value and writes none outside the secrets directory', () => {
    const first = sandbox.run(PROVISION, [], provisionEnv(sandbox));
    expect(first.status, first.output).toBe(0);
    const everything = `${first.output}\n${readFileSync(sandbox.log, 'utf8')}`;
    for (const canary of canaries) expect(everything).not.toContain(canary);
    for (const name of Object.keys(state())) {
      if (name.startsWith(join('run', 'cognitive-dag', 'secrets'))) continue;
      const text = readFileSync(join(sandbox.root, name), 'utf8');
      for (const canary of canaries) expect(text, name).not.toContain(canary);
    }
    // The secrets that were there are still there, unchanged.
    expect(
      readFileSync(sandbox.path('run/cognitive-dag/secrets', GENERATED[0] ?? ''), 'utf8'),
    ).toBe(canaries[0]);
  });

  it('writes nothing inside the repository tree', () => {
    const before = snapshot(join(ROOT, 'deploy'));
    const result = sandbox.run(PROVISION, [], provisionEnv(sandbox));
    expect(result.status, result.output).toBe(0);
    expect(snapshot(join(ROOT, 'deploy'))).toEqual(before);
  });

  it('leaves no secret and no key on the persistent filesystem of the sandbox', () => {
    const result = sandbox.run(PROVISION, [], provisionEnv(sandbox));
    expect(result.status, result.output).toBe(0);
    const persistent = Object.keys(state()).filter((name) => !name.startsWith('run'));
    for (const name of persistent) {
      expect(name, name).not.toMatch(/(password|\.key$|ca-private|token)/i);
    }
  });

  it('hardens SSH (keys only, no root), enables fail2ban and opens only 22, 80 and 443', () => {
    const result = sandbox.run(PROVISION, [], provisionEnv(sandbox));
    expect(result.status, result.output).toBe(0);
    const ssh = readFileSync(sandbox.path('etc/ssh/sshd_config.d/10-cognitive-dag.conf'), 'utf8');
    expect(ssh).toMatch(/^PasswordAuthentication no$/m);
    expect(ssh).toMatch(/^PermitRootLogin no$/m);
    expect(ssh).toMatch(/^KbdInteractiveAuthentication no$/m);
    expect(ssh).toMatch(/^PubkeyAuthentication yes$/m);
    const jail = readFileSync(sandbox.path('etc/fail2ban/jail.d/cognitive-dag.local'), 'utf8');
    expect(jail).toMatch(/\[sshd\]/);
    expect(jail).toMatch(/enabled\s*=\s*true/);

    const ufw = sandbox.calls().filter((call) => call.startsWith('ufw'));
    expect(ufw.join('\n')).toMatch(/default deny incoming/);
    const allowed = ufw.filter((call) => /\b(allow|limit)\b/.test(call)).join('\n');
    for (const port of ['22', '80', '443']) expect(allowed).toContain(`${port}/tcp`);
    expect(allowed).not.toMatch(/\b(8233|5432|6379|7233)\b/);
    // sshd is validated before it is reloaded, so a bad drop-in cannot lock the operator out.
    const sshCalls = sandbox
      .calls()
      .filter((call) => call.startsWith('sshd') || /^systemctl reload.*ssh/.test(call));
    expect(sshCalls[0]).toMatch(/^sshd -t/);
  });

  describe('firewall (ADR-0097)', () => {
    const run = (): ReturnType<Sandbox['run']> => {
      const result = sandbox.run(PROVISION, [], provisionEnv(sandbox));
      expect(result.status, result.output).toBe(0);
      return result;
    };
    const chainRules = (chain: string): string[] =>
      readFileSync(sandbox.path(IPTABLES_STATE), 'utf8')
        .split('\n')
        .filter((line) => line.startsWith(`R ${chain} `))
        .map((line) => line.slice(`R ${chain} `.length));
    const saved = (): string => sandbox.path('etc/cognitive-dag/oracle-instance-services.rules');

    it("removes Oracle's generic REJECT rules from INPUT and FORWARD, and no other rule", () => {
      seedRules(sandbox, ORACLE_RULES);
      run();
      expect(liveRules(sandbox).join('\n')).not.toMatch(/icmp-host-prohibited/);
      expect(chainRules('INPUT')).toEqual([
        '-m state --state RELATED,ESTABLISHED -j ACCEPT',
        '-p tcp -m state --state NEW -m tcp --dport 22 -j ACCEPT',
      ]);
    });

    it('does not depend on netfilter-persistent and leaves rules.v4 alone', () => {
      mkdirSync(sandbox.path('etc/iptables'), { recursive: true });
      const stock =
        '*filter\n:INPUT ACCEPT [0:0]\n-A INPUT -j REJECT --reject-with icmp-host-prohibited\nCOMMIT\n';
      writeFileSync(sandbox.path('etc/iptables/rules.v4'), stock);
      seedRules(sandbox, ORACLE_RULES);
      const result = run();
      expect(readFileSync(sandbox.path('etc/iptables/rules.v4'), 'utf8')).toBe(stock);
      expect(result.output).not.toMatch(/netfilter-persistent/);
      expect(sandbox.calls().filter((call) => call.startsWith('netfilter-persistent'))).toEqual([]);
    });

    it('keeps the InstanceServices rules and loads them again after a reboot', () => {
      seedRules(sandbox, ORACLE_RULES);
      run();
      const text = readFileSync(saved(), 'utf8');
      expect(text).toMatch(/^:InstanceServices - \[0:0\]$/m);
      expect(text).toMatch(/^-A InstanceServices -d 169\.254\.0\.2\/32 .*--dport 3260 -j ACCEPT$/m);
      expect(text).toMatch(
        /^-A InstanceServices -d 169\.254\.0\.0\/16 -p tcp -j REJECT --reject-with tcp-reset$/m,
      );
      expect(text).toMatch(/^COMMIT$/m);
      expect(chainRules('OUTPUT')).toContain('-d 169.254.0.0/16 -j InstanceServices');

      // A reboot: memory is empty and only the unit runs, with the file saved on disk.
      writeFileSync(sandbox.path(IPTABLES_STATE), '');
      const boot = sandbox.run(FIREWALL, ['apply'], { CDAG_INSTANCE_SERVICES: posix(saved()) });
      expect(boot.status, boot.output).toBe(0);
      expect(chainRules('InstanceServices')).toHaveLength(2);
      expect(chainRules('OUTPUT')).toEqual(['-d 169.254.0.0/16 -j InstanceServices']);
    });

    it('takes the InstanceServices rules from the stock rules.v4 when memory has none', () => {
      mkdirSync(sandbox.path('etc/iptables'), { recursive: true });
      const rule =
        '-A InstanceServices -d 169.254.0.0/16 -p udp -j REJECT --reject-with icmp-port-unreachable';
      writeFileSync(
        sandbox.path('etc/iptables/rules.v4'),
        `*filter\n:InstanceServices - [0:0]\n-A OUTPUT -d 169.254.0.0/16 -j InstanceServices\n${rule}\nCOMMIT\n`,
      );
      run();
      expect(readFileSync(saved(), 'utf8')).toContain(rule);
      expect(chainRules('InstanceServices')).toHaveLength(1);
    });

    it('does not overwrite the saved copy with whatever is loaded later', () => {
      seedRules(sandbox, ORACLE_RULES);
      run();
      const first = readFileSync(saved(), 'utf8');
      seedRules(sandbox, ['N InstanceServices', 'R InstanceServices -j ACCEPT']);
      run();
      expect(readFileSync(saved(), 'utf8')).toBe(first);
    });

    it('blocks containers from 169.254.0.0/16 in DOCKER-USER, DNS to the resolver excepted', () => {
      run();
      expect(chainRules('DOCKER-USER')).toEqual(['-j COGNITIVE-DAG-METADATA']);
      expect(chainRules('COGNITIVE-DAG-METADATA')).toEqual([
        '-d 169.254.169.254/32 -p udp --dport 53 -j RETURN',
        '-d 169.254.169.254/32 -p tcp --dport 53 -j RETURN',
        '-d 169.254.0.0/16 -j REJECT --reject-with icmp-admin-prohibited',
      ]);
      // Only the metadata network is touched: nothing else of the containers' egress is dropped.
      for (const rule of chainRules('COGNITIVE-DAG-METADATA'))
        expect(rule).toMatch(/^-d 169\.254\./);
    });

    it('is idempotent: a second run leaves the same rules and no duplicate', () => {
      seedRules(sandbox, ORACLE_RULES);
      run();
      const first = liveRules(sandbox);
      run();
      expect(liveRules(sandbox)).toEqual(first);
      expect(new Set(first).size).toBe(first.length);
    });

    it('installs a unit that reapplies at boot and on a Docker restart, before the stack', () => {
      run();
      const unit = readFileSync(
        sandbox.path('etc/systemd/system/cognitive-dag-firewall.service'),
        'utf8',
      );
      expect(unit).toMatch(/^After=.*\bdocker\.service\b/m);
      expect(unit).toMatch(/^After=.*\bufw\.service\b/m);
      expect(unit).toMatch(/^Requires=docker\.service$/m);
      expect(unit).toMatch(/^PartOf=docker\.service$/m);
      expect(unit).toMatch(/^Before=cognitive-dag\.service$/m);
      expect(unit).toMatch(/^Type=oneshot$/m);
      expect(unit).toMatch(/^RemainAfterExit=yes$/m);
      expect(unit).toMatch(
        /^ExecStart=\/usr\/bin\/bash \/opt\/cognitive-dag\/deploy\/provision\/firewall\.sh apply$/m,
      );
      expect(unit).toMatch(/^WantedBy=multi-user\.target$/m);
      expect(sandbox.calls().join('\n')).toMatch(
        /systemctl enable .*cognitive-dag-firewall\.service/,
      );
    });

    it('refuses an unknown command', () => {
      expect(sandbox.run(FIREWALL, ['flush']).status).toBe(2);
      expect(sandbox.calls().filter((call) => call.startsWith('iptables'))).toEqual([]);
    });
  });

  it('installs the units: secrets fail closed, then the stack, alerts every 5 minutes', () => {
    const result = sandbox.run(PROVISION, [], provisionEnv(sandbox));
    expect(result.status, result.output).toBe(0);
    const unit = (name: string): string =>
      readFileSync(sandbox.path('etc/systemd/system', name), 'utf8');

    const secrets = unit('cognitive-dag-secrets.service');
    expect(secrets).toMatch(/^Type=oneshot$/m);
    expect(secrets).toMatch(/^RemainAfterExit=yes$/m);
    expect(secrets).toMatch(/^RuntimeDirectory=cognitive-dag$/m);
    expect(secrets).toMatch(
      /^ExecStart=\/opt\/cognitive-dag\/deploy\/provision\/secrets\.sh fetch$/m,
    );
    // No `-` prefix on a command: a failed fetch must fail the unit.
    expect(secrets).not.toMatch(/^Exec\w+=-/m);

    const stack = unit('cognitive-dag.service');
    expect(stack).toMatch(/^Requires=.*cognitive-dag-secrets\.service/m);
    expect(stack).toMatch(/^After=.*cognitive-dag-secrets\.service/m);

    expect(unit('cognitive-dag-alerts.timer')).toMatch(/^OnUnitActiveSec=5min$/m);
    expect(unit('cognitive-dag-alerts.service')).toMatch(/alerts\.sh check/);

    const rotation = readFileSync(sandbox.path('etc/logrotate.d/cognitive-dag'), 'utf8');
    expect(rotation).toMatch(/^\s*rotate 90$/m);
    expect(rotation).toMatch(/^\s*daily$/m);
    expect(rotation).toMatch(/^\s*compress$/m);

    expect(sandbox.calls().join('\n')).toMatch(/systemctl enable .*cognitive-dag-alerts\.timer/);
  });
});

describe('secrets.sh fetch (T039, FR-015)', () => {
  let sandbox: Sandbox;
  let values: Record<string, string>;
  let vault: string;

  /** Env of a fetch on the VM: the paths point inside the sandbox. */
  const env = (extra: Record<string, string> = {}): Record<string, string> => ({
    CDAG_SECRETS: posix(sandbox.path('run/cognitive-dag/secrets')),
    CDAG_PKI: posix(sandbox.path('run/cognitive-dag/pki')),
    CDAG_CONFIG_DIR: posix(sandbox.path('etc/cognitive-dag')),
    VAULT_OCID: 'ocid1.vault.oc1..test',
    STUB_VAULT: posix(vault),
    STUB_FSTYPE: 'tmpfs',
    ...extra,
  });
  const secretsDir = (): string => sandbox.path('run/cognitive-dag/secrets');
  const listed = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir) : []);

  beforeEach(() => {
    sandbox = createSandbox();
    vault = sandbox.path('vault');
    mkdirSync(vault, { recursive: true });
    mkdirSync(sandbox.path('run/cognitive-dag'), { recursive: true });
    values = {};
    for (const name of [...GENERATED, ...DELIVERED]) {
      values[name] = random();
      writeFileSync(join(vault, name), values[name] ?? '');
    }
    // A real CA, made by the PKI script of the repository, is what the Vault holds.
    const caDir = sandbox.path('ca-made');
    const made = sandbox.run(PKI, ['init', posix(caDir), '--ca-key', posix(join(caDir, 'ca.key'))]);
    expect(made.status, made.output).toBe(0);
    writeFileSync(join(vault, 'pki_ca_key'), readFileSync(join(caDir, 'ca.key')));
    writeFileSync(join(vault, 'pki_ca_crt'), readFileSync(join(caDir, 'ca.crt')));
    sandbox.stub(
      'oci',
      `if [[ -n "\${STUB_VAULT_DOWN:-}" ]]; then echo "ServiceError: connection refused" >&2; exit 1; fi
name=""
while (($#)); do [[ "$1" == --secret-name ]] && name="\${2#cdag-}"; shift; done
[[ -f "$STUB_VAULT/$name" ]] || { echo "ServiceError: not found" >&2; exit 1; }
base64 <"$STUB_VAULT/$name" | tr -d '\\n'`,
    );
    sandbox.stub(
      'stat',
      'if [[ "$1" == "-f" ]]; then echo "$STUB_FSTYPE"; else exec /usr/bin/stat "$@"; fi',
    );
  });
  afterEach(() => sandbox.cleanup());

  it('writes every secret to the tmpfs and the PKI leaves, and prints no value', () => {
    const result = sandbox.run(SECRETS, ['fetch'], env());
    expect(result.status, result.output).toBe(0);
    for (const [name, value] of Object.entries(values)) {
      expect(readFileSync(join(secretsDir(), name), 'utf8'), name).toBe(value);
      expect(result.output).not.toContain(value);
    }
    const pki = sandbox.path('run/cognitive-dag/pki');
    for (const leaf of ['postgres', 'valkey', 'temporal', 'temporal-client-api']) {
      expect(existsSync(join(pki, `${leaf}.crt`)), leaf).toBe(true);
      expect(existsSync(join(pki, `${leaf}.key`)), leaf).toBe(true);
    }
    expect(existsSync(join(pki, 'ca.crt'))).toBe(true);
    // The CA key is used to sign and then removed from the tmpfs.
    expect(existsSync(join(secretsDir(), 'pki_ca_key'))).toBe(false);
    const everywhere = readdirSync(sandbox.path('run/cognitive-dag'), { recursive: true }).map(
      String,
    );
    expect(everywhere.filter((name) => /ca\.key$/.test(name))).toEqual([]);
    // The OCI CLI authenticates with the instance principal: no API key, no profile.
    const ociCalls = sandbox.calls().filter((call) => call.startsWith('oci'));
    expect(ociCalls.length).toBeGreaterThanOrEqual(GENERATED.length + DELIVERED.length);
    for (const call of ociCalls) expect(call).toContain('--auth instance_principal');
    for (const value of Object.values(values)) {
      expect(sandbox.calls().join('\n')).not.toContain(value);
    }
  });

  it.skipIf(!POSIX_MODES)('uses a 0700 directory and read-only files', () => {
    const result = sandbox.run(SECRETS, ['fetch'], env());
    expect(result.status, result.output).toBe(0);
    expect(statSync(secretsDir()).mode & 0o777).toBe(0o700);
    expect(statSync(join(secretsDir(), 'app_runtime_password')).mode & 0o777).toBe(0o444);
    // Only the registry token is for the host and not for a container: root only.
    expect(statSync(join(secretsDir(), 'ocir_pull_token')).mode & 0o777).toBe(0o400);
  });

  /** Every file Compose mounts into a container: all but the registry token, which docker login reads. */
  const mounted = (): string[] => [
    ...GENERATED.map((name) => join(secretsDir(), name)),
    ...DELIVERED.filter((name) => name !== 'ocir_pull_token').map((name) =>
      join(secretsDir(), name),
    ),
    ...readdirSync(sandbox.path('run/cognitive-dag/pki')).map((name) =>
      join(sandbox.path('run/cognitive-dag/pki'), name),
    ),
  ];

  it.skipIf(!POSIX_MODES)(
    'leaves ca.crt and every mounted file readable by others, with the CA already in the Vault',
    () => {
      const result = sandbox.run(SECRETS, ['fetch'], env());
      expect(result.status, result.output).toBe(0);
      const pki = sandbox.path('run/cognitive-dag/pki');
      expect(statSync(join(pki, 'ca.crt')).mode & 0o777).toBe(0o444);
      for (const file of mounted()) {
        expect(statSync(file).mode & 0o004, file).toBe(0o004);
      }
    },
  );

  it.skipIf(!POSIX_MODES)('fails and installs nothing when a mounted file is not readable', () => {
    // A stub chmod that leaves ca.crt private stands for the regression this check guards.
    sandbox.stub(
      'chmod',
      'if [[ "${*: -1}" == */ca.crt ]]; then exit 0; fi; exec /usr/bin/chmod "$@"',
    );
    const result = sandbox.run(SECRETS, ['fetch'], env());
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('ca.crt');
    expect(listed(secretsDir())).toEqual([]);
  });

  it('is repeatable: a second fetch gives the same files', () => {
    expect(sandbox.run(SECRETS, ['fetch'], env()).status).toBe(0);
    const first = snapshot(secretsDir());
    expect(sandbox.run(SECRETS, ['fetch'], env()).status).toBe(0);
    expect(snapshot(secretsDir())).toEqual(first);
  });

  it('fails closed and writes nothing when the Vault does not answer', () => {
    const result = sandbox.run(SECRETS, ['fetch'], env({ STUB_VAULT_DOWN: '1' }));
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/vault/i);
    expect(listed(secretsDir())).toEqual([]);
    for (const value of Object.values(values)) expect(result.output).not.toContain(value);
  });

  it('fails closed when one secret is missing, leaving no partial set', () => {
    rmSync(join(vault, 'smtp_password'));
    const result = sandbox.run(SECRETS, ['fetch'], env());
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('smtp_password');
    expect(listed(secretsDir())).toEqual([]);
  });

  it('refuses to write anywhere that is not a tmpfs', () => {
    const result = sandbox.run(SECRETS, ['fetch'], env({ STUB_FSTYPE: 'ext4' }));
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/tmpfs/);
    expect(listed(secretsDir())).toEqual([]);
    // It does not even ask the Vault: nothing to leak where it cannot be stored safely.
    expect(sandbox.calls().filter((call) => call.startsWith('oci'))).toEqual([]);
  });
});

describe('secrets.sh from the operator machine (T039, FR-015)', () => {
  let sandbox: Sandbox;
  const operatorEnv = (extra: Record<string, string> = {}): Record<string, string> => ({
    VAULT_OCID: 'ocid1.vault.oc1..test',
    OCI_COMPARTMENT_OCID: 'ocid1.compartment.oc1..test',
    OCI_VAULT_KEY_OCID: 'ocid1.key.oc1..test',
    ...extra,
  });

  beforeEach(() => {
    sandbox = createSandbox();
    // `secret list` prints the id of an existing secret, or nothing; STUB_EXISTING names those.
    sandbox.stub(
      'oci',
      `if [[ "$1 $2 $3" == "vault secret list" ]]; then
  name=""; while (($#)); do [[ "$1" == --name ]] && name="\${2#cdag-}"; shift; done
  case " \${STUB_EXISTING:-} " in *" $name "*) echo "ocid1.vaultsecret.oc1..$name" ;; esac
fi`,
    );
  });
  afterEach(() => sandbox.cleanup());

  it('init-generated creates the generated secrets and the CA, once', () => {
    const first = sandbox.run(SECRETS, ['init-generated'], operatorEnv());
    expect(first.status, first.output).toBe(0);
    const creates = sandbox.calls().filter((call) => call.includes('create-base64'));
    for (const name of [...GENERATED, 'pki_ca_key', 'pki_ca_crt']) {
      expect(
        creates.filter((call) => call.includes(`--secret-name cdag-${name}`)),
        name,
      ).toHaveLength(1);
    }
    expect(creates).toHaveLength(GENERATED.length + 2);
    // Nothing is printed: not a value and not the base64 of one.
    for (const call of creates) {
      const content = /--secret-content-content (\S+)/.exec(call)?.[1] ?? '';
      expect(content.length).toBeGreaterThan(20);
      expect(first.output).not.toContain(content);
      expect(first.output).not.toContain(Buffer.from(content, 'base64').toString('utf8'));
    }
  });

  it('init-generated never overwrites a secret that already exists', () => {
    const existing = [...GENERATED, 'pki_ca_key', 'pki_ca_crt'].join(' ');
    const result = sandbox.run(
      SECRETS,
      ['init-generated'],
      operatorEnv({ STUB_EXISTING: existing }),
    );
    expect(result.status, result.output).toBe(0);
    expect(sandbox.calls().filter((call) => /create-base64|update-base64/.test(call))).toEqual([]);
  });

  it('put reads the value from stdin, stores a new version and prints nothing of it', () => {
    const value = random();
    const result = sandbox.run(
      SECRETS,
      ['put', 'gemini_api_key'],
      operatorEnv({ STUB_EXISTING: 'gemini_api_key' }),
      `${value}\n`,
    );
    expect(result.status, result.output).toBe(0);
    const update = sandbox.calls().filter((call) => call.includes('update-base64'));
    expect(update).toHaveLength(1);
    expect(update[0]).toContain('ocid1.vaultsecret.oc1..gemini_api_key');
    expect(result.output).not.toContain(value);
    // The value is not a plain argument either, and a name that is not ours is refused.
    expect(sandbox.calls().join('\n')).not.toContain(value);
    expect(sandbox.run(SECRETS, ['put', 'not_a_secret'], operatorEnv(), 'x\n').status).not.toBe(0);
  });

  it('put refuses an empty value', () => {
    const result = sandbox.run(SECRETS, ['put', 'smtp_user'], operatorEnv(), '\n');
    expect(result.status).not.toBe(0);
    expect(sandbox.calls().filter((call) => /create-base64|update-base64/.test(call))).toEqual([]);
  });
});
