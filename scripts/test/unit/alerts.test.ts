import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSandbox, hasCommand, posix, ROOT, type Sandbox } from '../support/sandbox.ts';

// Starting bash is slow on Windows; the scripts themselves are quick.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

/**
 * F9 (T041, FR-027, FR-028): the alert counter of `auth.login_failed` and `auth.rate_limited` has a
 * sliding window and fires above the threshold and not below; each alert (service, certificate,
 * disk) produces its own mail, sent to a test SMTP server over STARTTLS with authentication, with
 * a certificate made at run time. The scripts run in a temporary directory; docker is a stub that
 * prints the log lines of the test.
 */
const ALERTS = 'deploy/ops/alerts.sh';
const PKI = 'deploy/provision/pki.sh';

interface Mail {
  from: string;
  to: string[];
  data: string;
  user: string;
  password: string;
}

/** The test SMTP server (`support/smtp-server.ts`) runs as its own process; mails are read from its file. */
interface TestSmtp {
  port: number;
  readonly mails: Mail[];
  reset: () => void;
  stop: () => void;
}

function startSmtp(key: string, cert: string, out: string): Promise<TestSmtp> {
  writeFileSync(out, '');
  const child = spawn(
    process.execPath,
    [join(ROOT, 'scripts/test/support/smtp-server.ts'), key, cert, out],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.stdout.on('data', (chunk: Buffer) => {
      const port = /listening (\d+)/.exec(chunk.toString('utf8'))?.[1];
      if (!port) return;
      resolve({
        port: Number(port),
        get mails() {
          return readFileSync(out, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as Mail);
        },
        reset: () => writeFileSync(out, ''),
        stop: () => void child.kill(),
      });
    });
  });
}

describe('shellcheck', () => {
  it.skipIf(!hasCommand('shellcheck'))('is clean on alerts.sh', () => {
    const run = spawnSync('shellcheck', ['-x', posix(join(ROOT, ALERTS))], { encoding: 'utf8' });
    expect(run.stdout + run.stderr).toBe('');
    expect(run.status).toBe(0);
  });
});

describe.skipIf(!hasCommand('openssl') || !hasCommand('curl'))('alerts.sh check (T041)', () => {
  let sandbox: Sandbox;
  let smtp: TestSmtp;
  let caFile: string;
  const smtpUser = `user-${randomBytes(4).toString('hex')}`;
  const smtpPassword = randomBytes(16).toString('base64url');

  beforeAll(async () => {
    const work = createSandbox();
    const key = work.path('smtp.key');
    const cert = work.path('smtp.crt');
    const made = spawnSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'ec',
        '-pkeyopt',
        'ec_paramgen_curve:P-256',
        '-nodes',
        '-keyout',
        posix(key),
        '-out',
        posix(cert),
        '-days',
        '2',
        '-subj',
        '/CN=127.0.0.1',
        '-addext',
        'subjectAltName=IP:127.0.0.1',
      ],
      { encoding: 'utf8' },
    );
    expect(made.status, made.stderr).toBe(0);
    smtp = await startSmtp(key, cert, work.path('mails.jsonl'));
    caFile = cert;
  });
  afterAll(() => {
    smtp.stop();
  });

  const iso = (minutesAgo: number): string =>
    new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const line = (event: string, minutesAgo: number): string =>
    JSON.stringify({
      level: 'info',
      time: iso(minutesAgo),
      component: 'api',
      event,
      outcome: 'failure',
    });
  const SERVICES = ['edge', 'api', 'worker', 'postgres', 'valkey', 'temporal', 'temporal-ui'];

  beforeEach(() => {
    sandbox = createSandbox();
    smtp.reset();
    for (const folder of [
      'etc/cognitive-dag',
      'run/cognitive-dag/secrets',
      'var/lib/cognitive-dag/state',
      'opt/cognitive-dag/deploy',
    ]) {
      mkdirSync(sandbox.path(folder), { recursive: true });
    }
    writeFileSync(sandbox.path('opt/cognitive-dag/deploy/compose.prod.yaml'), 'name: x\n');
    writeFileSync(sandbox.path('etc/cognitive-dag/cognitive-dag.env'), 'SMTP_HOST=127.0.0.1\n');
    writeFileSync(sandbox.path('etc/cognitive-dag/local.env'), 'SITE_DOMAIN=demo.example.test\n');
    writeFileSync(sandbox.path('run/cognitive-dag/secrets/smtp_user'), smtpUser);
    writeFileSync(sandbox.path('run/cognitive-dag/secrets/smtp_password'), smtpPassword);
    // A real internal PKI, so the certificate check runs the real script.
    const pki = sandbox.run(PKI, [
      'init',
      posix(sandbox.path('run/cognitive-dag/pki')),
      '--ca-key',
      posix(sandbox.path('ca-private/ca.key')),
    ]);
    expect(pki.status, pki.output).toBe(0);
    writeFileSync(sandbox.path('logs-api.txt'), '');
    sandbox.stub(
      'docker',
      `case "$*" in
  *" ps "*) for s in \${STUB_SERVICES:-}; do echo "$s \${STUB_STATE:-running} \${STUB_HEALTH:-healthy}"; done ;;
  *" logs "*" api"*) cat "$STUB_API_LOGS" ;;
  *" logs "*) echo "caddy line" ;;
esac`,
    );
  });
  afterEach(() => sandbox.cleanup());

  const env = (extra: Record<string, string> = {}): Record<string, string> => ({
    CDAG_ROOT: posix(sandbox.path('opt/cognitive-dag')),
    CDAG_STATE: posix(sandbox.path('var/lib/cognitive-dag')),
    CDAG_SECRETS: posix(sandbox.path('run/cognitive-dag/secrets')),
    CDAG_PKI: posix(sandbox.path('run/cognitive-dag/pki')),
    CDAG_CONFIG_DIR: posix(sandbox.path('etc/cognitive-dag')),
    CDAG_LOG_DIR: posix(sandbox.path('var/log/cognitive-dag')),
    ALERT_EMAIL_TO: 'operator@example.test',
    MAIL_FROM: 'Alertas <alertas@example.test>',
    SMTP_PORT: String(smtp.port),
    ALERT_SMTP_CACERT: posix(caFile),
    ALERT_AUTH_THRESHOLD: '3',
    ALERT_WINDOW_MINUTES: '10',
    ALERT_CERT_MIN_DAYS: '30',
    ALERT_DISK_PERCENT: '100',
    STUB_SERVICES: SERVICES.join(' '),
    STUB_API_LOGS: posix(sandbox.path('logs-api.txt')),
    ...extra,
  });
  const check = (extra: Record<string, string> = {}) => sandbox.run(ALERTS, ['check'], env(extra));
  const writeLogs = (lines: string[]): void =>
    writeFileSync(sandbox.path('logs-api.txt'), `${lines.join('\n')}\n`);

  it('sends nothing when everything is healthy', () => {
    const result = check();
    expect(result.status, result.output).toBe(0);
    expect(smtp.mails).toEqual([]);
  });

  describe('authentication failures (sliding window)', () => {
    it('does not fire at or below the threshold', () => {
      writeLogs([
        line('auth.login_failed', 1),
        line('auth.rate_limited', 2),
        line('auth.login_failed', 3),
      ]);
      expect(check().status).toBe(0);
      expect(smtp.mails).toEqual([]);
    });

    it('fires above the threshold, counting both events, and says how many', () => {
      writeLogs([
        line('auth.login_failed', 1),
        line('auth.rate_limited', 2),
        line('auth.login_failed', 3),
        line('auth.rate_limited', 4),
      ]);
      const result = check();
      expect(result.status, result.output).toBe(0);
      expect(smtp.mails).toHaveLength(1);
      const mail = smtp.mails[0];
      expect(mail?.data).toMatch(/^Subject: .*auth/im);
      expect(mail?.data).toMatch(/\b4\b/);
      expect(mail?.to).toEqual(['operator@example.test']);
      expect(mail?.from).toBe('alertas@example.test');
    });

    it('does not count events that left the window', () => {
      writeLogs([
        ...Array.from({ length: 10 }, () => line('auth.login_failed', 30)),
        line('auth.login_failed', 1),
        line('auth.login_failed', 2),
      ]);
      expect(check().status).toBe(0);
      expect(smtp.mails).toEqual([]);
    });

    it('ignores other events and lines that are not JSON', () => {
      writeLogs([
        ...Array.from({ length: 10 }, () => line('auth.login_succeeded', 1)),
        'not json at all auth.login_failed',
      ]);
      expect(check().status).toBe(0);
      expect(smtp.mails).toEqual([]);
    });
  });

  it('mails when a service is not healthy', () => {
    const result = check({ STUB_HEALTH: 'unhealthy' });
    expect(result.status, result.output).toBe(0);
    expect(smtp.mails).toHaveLength(1);
    expect(smtp.mails[0]?.data).toMatch(/^Subject: .*service/im);
    expect(smtp.mails[0]?.data).toContain('api');
  });

  it('mails when a service is not running or is missing', () => {
    expect(check({ STUB_STATE: 'restarting' }).status).toBe(0);
    expect(smtp.mails).toHaveLength(1);
    smtp.reset();
    rmState();
    expect(check({ STUB_SERVICES: 'edge api worker' }).status).toBe(0);
    expect(smtp.mails).toHaveLength(1);
    expect(smtp.mails[0]?.data).toContain('postgres');
  });

  it('mails when an internal certificate is close to expiring', () => {
    const result = check({ ALERT_CERT_MIN_DAYS: '120' });
    expect(result.status, result.output).toBe(0);
    expect(smtp.mails).toHaveLength(1);
    expect(smtp.mails[0]?.data).toMatch(/^Subject: .*certificate/im);
    expect(smtp.mails[0]?.data).toMatch(/\.crt/);
  });

  it('mails when the disk is over the threshold', () => {
    const result = check({ ALERT_DISK_PERCENT: '0' });
    expect(result.status, result.output).toBe(0);
    expect(smtp.mails).toHaveLength(1);
    expect(smtp.mails[0]?.data).toMatch(/^Subject: .*disk/im);
  });

  it('sends one mail per alert, each with its own subject', () => {
    writeLogs(Array.from({ length: 5 }, () => line('auth.login_failed', 1)));
    const result = check({
      STUB_HEALTH: 'unhealthy',
      ALERT_CERT_MIN_DAYS: '120',
      ALERT_DISK_PERCENT: '0',
    });
    expect(result.status, result.output).toBe(0);
    const subjects = smtp.mails.map((mail) => /^Subject: (.*)$/im.exec(mail.data)?.[1] ?? '');
    expect(subjects).toHaveLength(4);
    expect(new Set(subjects).size).toBe(4);
  });

  it('authenticates to the SMTP server over STARTTLS and never prints the credentials', () => {
    const result = check({ ALERT_DISK_PERCENT: '0' });
    expect(result.status, result.output).toBe(0);
    expect(smtp.mails[0]?.user).toBe(smtpUser);
    expect(smtp.mails[0]?.password).toBe(smtpPassword);
    expect(result.output).not.toContain(smtpPassword);
    expect(readFileSync(sandbox.log, 'utf8')).not.toContain(smtpPassword);
    // The mail itself says nothing of the secrets either.
    expect(smtp.mails[0]?.data).not.toContain(smtpPassword);
  });

  it('refuses a server whose certificate it does not trust', () => {
    const result = check({
      ALERT_DISK_PERCENT: '0',
      ALERT_SMTP_CACERT: posix(sandbox.path('run/cognitive-dag/pki/ca.crt')),
    });
    expect(result.status).not.toBe(0);
    expect(smtp.mails).toEqual([]);
  });

  it('does not repeat the same alert inside the cooldown, and repeats it once it recovered', () => {
    expect(check({ ALERT_DISK_PERCENT: '0' }).status).toBe(0);
    expect(check({ ALERT_DISK_PERCENT: '0' }).status).toBe(0);
    expect(smtp.mails).toHaveLength(1);
    // The condition clears: the next occurrence alerts again at once.
    expect(check({ ALERT_DISK_PERCENT: '100' }).status).toBe(0);
    expect(check({ ALERT_DISK_PERCENT: '0' }).status).toBe(0);
    expect(smtp.mails).toHaveLength(2);
  });

  it('fails without a destination address', () => {
    const result = check({ ALERT_EMAIL_TO: '' });
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/ALERT_EMAIL_TO/);
  });

  it('archives the service logs to files and moves its cursor', () => {
    writeLogs([line('run.started', 1)]);
    const first = sandbox.run(ALERTS, ['archive'], env());
    expect(first.status, first.output).toBe(0);
    const apiLog = readFileSync(sandbox.path('var/log/cognitive-dag/api.log'), 'utf8');
    expect(apiLog).toContain('run.started');
    expect(readFileSync(sandbox.path('var/log/cognitive-dag/edge.log'), 'utf8')).toContain(
      'caddy line',
    );
    sandbox.clearCalls();
    expect(sandbox.run(ALERTS, ['archive'], env()).status).toBe(0);
    // The second run asks only for what is new since the first one.
    expect(sandbox.calls().filter((call) => / logs /.test(call))[0]).toMatch(
      /--since \d{4}-\d{2}-\d{2}T/,
    );
  });

  function rmState(): void {
    writeFileSync(sandbox.path('var/lib/cognitive-dag/state/.keep'), '');
    spawnSync('bash', ['-c', `rm -rf "${posix(sandbox.path('var/lib/cognitive-dag/alerts'))}"`]);
  }
});
