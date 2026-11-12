import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

/**
 * F9 contract tests on the deployment files (T028, T029, FR-017, SC-010). They read the files and
 * never start anything: the Caddyfile against `specs/010-deployment/contracts/edge-headers.md`, and
 * the production Compose against the rules of exposure, limits and users. A rule relaxed in a file
 * fails here on its own.
 */
const ROOT = resolve(import.meta.dirname, '../../..');
const read = (file: string): string => {
  const path = resolve(ROOT, file);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
};

/** Comments out of the way, so a rule named only in a comment does not count. */
const code = (source: string): string =>
  source
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');

// The Caddyfile imports the site snippet: the contract covers both files.
const caddyfile = code(read('deploy/caddy/Caddyfile'));
const site = code(read('deploy/caddy/site.caddy'));
const caddy = `${caddyfile}\n${site}`;

describe('Caddyfile (edge-headers contract, T028)', () => {
  it('exists and takes the domain from SITE_DOMAIN, never from a literal', () => {
    expect(caddyfile).not.toBe('');
    expect(caddyfile).toContain('{$SITE_DOMAIN');
    expect(caddy).not.toMatch(/\bhttps?:\/\/(?!\{)[a-z0-9-]+\.(com|org|net|io|dev|app)\b/i);
  });

  it('redirects HTTP to HTTPS keeping the path, with no content', () => {
    expect(caddyfile).toMatch(/http:\/\/\{\$SITE_DOMAIN/);
    expect(caddyfile).toMatch(/redir\s+https:\/\/\{host\}\{uri\}\s+301/);
  });

  it('keeps automatic TLS on', () => {
    expect(caddy).not.toMatch(/auto_https\s+off/);
    expect(caddy).not.toMatch(/\btls\s+internal\b/);
  });

  it('sends the security headers of the static web with the contract values', () => {
    expect(site).toMatch(/Content-Security-Policy\s+"[^"]*default-src 'self'/);
    expect(site).toMatch(/Content-Security-Policy\s+"[^"]*frame-ancestors 'none'/);
    expect(site).toMatch(/Content-Security-Policy\s+"[^"]*script-src 'self';/);
    expect(site).toMatch(/Content-Security-Policy\s+"[^"]*object-src 'none'/);
    expect(site).toMatch(/X-Frame-Options\s+"?DENY/);
    expect(site).toMatch(/X-Content-Type-Options\s+"?nosniff/);
    expect(site).toMatch(/Permissions-Policy\s+"[^"]*camera=\(\)/);
    expect(site).toMatch(/Permissions-Policy\s+"[^"]*interest-cohort=\(\)/);
    expect(site).toMatch(/Cross-Origin-Embedder-Policy\s+"?(require-corp|credentialless)/);
    expect(site).toMatch(/Cross-Origin-Opener-Policy\s+"?same-origin/);
    expect(site).toMatch(/Cross-Origin-Resource-Policy\s+"?same-origin/);
    expect(site).toMatch(/Referrer-Policy\s+"?strict-origin-when-cross-origin/);
    expect(site).toMatch(/Strict-Transport-Security\s+"max-age=31536000; includeSubDomains"/);
    expect(site).toMatch(/-Server\b/);
  });

  it('never allows unsafe-inline or unsafe-eval in script-src', () => {
    const policy = /Content-Security-Policy\s+"([^"]*)"/.exec(site)?.[1] ?? '';
    expect(policy).not.toBe('');
    const scriptSrc = policy.split(';').find((part) => part.trim().startsWith('script-src')) ?? '';
    expect(scriptSrc).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(policy).not.toMatch(/unsafe-eval/);
    expect(policy).not.toMatch(/preload/);
  });

  it('does not use preload in HSTS (subdomains are not verified yet)', () => {
    expect(caddy).not.toMatch(/Strict-Transport-Security[^\n]*preload/);
  });

  it('does not overwrite the Helmet headers of the API', () => {
    const api = /handle\s+\/api\/\*\s*\{[\s\S]*?\n\t\}/.exec(site)?.[0] ?? '';
    expect(api).toContain('reverse_proxy api:3000');
    expect(api).not.toMatch(/Content-Security-Policy|X-Frame-Options|Cross-Origin/);
  });

  it('streams server-sent events: no buffering and a read timeout above the heartbeat', () => {
    expect(site).toMatch(/flush_interval\s+-1/);
    const read = /read_timeout\s+(\d+)s/.exec(site);
    expect(read, 'read_timeout in seconds').not.toBeNull();
    // SSE_HEARTBEAT_MS defaults to 15 s.
    expect(Number(read?.[1])).toBeGreaterThan(15);
  });

  it('lets Caddy overwrite the forwarded headers: it trusts no proxy in front of it', () => {
    // Without trusted_proxies Caddy replaces X-Forwarded-For/-Proto with the real client, so the
    // client cannot forge them; header_up for them would only add a warning.
    expect(caddy).not.toMatch(/trusted_proxies|client_ip_headers/);
  });

  it('limits the request body and the time to read it', () => {
    expect(site).toMatch(/request_body\s*\{[^}]*max_size\s+\d+\s*(KB|kb|KiB)/);
    expect(caddyfile).toMatch(/read_body\s+\d+s/);
    expect(caddyfile).toMatch(/read_header\s+\d+s/);
  });

  it('caches hashed assets forever and revalidates index.html', () => {
    expect(site).toMatch(/Cache-Control\s+"public, max-age=31536000, immutable"/);
    expect(site).toMatch(/Cache-Control\s+"?no-cache/);
    expect(site).toMatch(/try_files\s+\{path\}\s+\/index\.html/);
  });

  it('compresses the static files only, never the event stream', () => {
    const api = /handle\s+\/api\/\*\s*\{[\s\S]*?\n\t\}/.exec(site)?.[0] ?? '';
    expect(api).not.toMatch(/\bencode\b/);
  });

  it('logs JSON to stdout and removes the webhook token and the credential headers', () => {
    expect(caddyfile).toMatch(/output\s+stdout/);
    // The default logger (error lines repeat the request) uses the same redaction as the site.
    expect(caddyfile).toMatch(/log\s*\{\s*import redacted_log/);
    expect(site).toMatch(/log\s*\{\s*import redacted_log/);
    // The local file used for checks redacts exactly like production.
    const snippet = (text: string) => /\(redacted_log\)\s*\{[\s\S]*?\n\}/.exec(text)?.[0];
    expect(snippet(caddyfile)).toBeDefined();
    expect(snippet(code(read('deploy/caddy/local.Caddyfile')))).toBe(snippet(caddyfile));
    expect(caddyfile).toMatch(/format\s+filter\s*\{[\s\S]*wrap\s+json/);
    for (const header of ['Cookie', 'Authorization', 'X-Csrf-Token']) {
      expect(caddyfile, header).toMatch(new RegExp(`request>headers>${header}\\s+delete`));
    }
    expect(caddyfile).toMatch(/resp_headers>Set-Cookie\s+delete/);
    expect(caddyfile).toMatch(/request>uri\s+regexp\s+\^?\(?\/api\/v1\/hooks/);
    expect(caddyfile).not.toMatch(/log_credentials|include_all/);
  });

  it('does not publish the metrics endpoint, the Temporal UI or the registration', () => {
    expect(site).toMatch(/\/api\/v1\/metrics/);
    expect(site).toMatch(/\/api\/v1\/auth\/register/);
    expect(site).toMatch(/respond\s+(@\w+\s+)?"?"?\s*404/);
    expect(caddy).not.toMatch(/reverse_proxy\s+[^\n]*(temporal|8233|8080)/i);
  });

  it('answers 404 to the closed registration before the proxy (D23A)', () => {
    const closed = site.indexOf('/api/v1/auth/register');
    const proxy = site.indexOf('reverse_proxy');
    expect(closed).toBeGreaterThan(-1);
    expect(closed).toBeLessThan(proxy);
  });

  it('keeps the global admin API off', () => {
    expect(caddyfile).toMatch(/admin\s+off/);
  });
});

interface Service {
  image?: string;
  ports?: string[];
  mem_limit?: string;
  restart?: string;
  healthcheck?: { test?: unknown; disable?: boolean };
  user?: string;
  logging?: { driver?: string; options?: Record<string, string> };
  secrets?: unknown[];
  environment?: Record<string, string> | string[];
  cap_drop?: string[];
  networks?: Record<string, unknown> | string[];
  depends_on?: Record<string, { condition?: string }>;
  volumes?: string[];
  labels?: Record<string, string>;
}
interface ComposeFile {
  services: Record<string, Service>;
  networks?: Record<string, { internal?: boolean }>;
  secrets?: Record<string, { file?: string }>;
}

const composeSource = read('deploy/compose.prod.yaml');
const compose = (
  composeSource ? parse(composeSource, { merge: true }) : { services: {} }
) as ComposeFile;
const services = Object.entries(compose.services);
/** One-shot jobs: they run to completion, so they have no health to report. */
const ONE_SHOT = new Set(['migrator', 'temporal-schema', 'temporal-init']);

const toMegabytes = (limit: string | undefined): number => {
  const match = /^(\d+)(m|g)$/i.exec(limit ?? '');
  if (!match) return Number.NaN;
  return Number(match[1]) * (match[2]?.toLowerCase() === 'g' ? 1024 : 1);
};

describe('Compose of production (T029)', () => {
  it('declares the expected services', () => {
    expect(Object.keys(compose.services).sort()).toEqual(
      [
        'api',
        'edge',
        'migrator',
        'postgres',
        'temporal',
        'temporal-init',
        'temporal-schema',
        'temporal-ui',
        'valkey',
        'worker',
      ].sort(),
    );
  });

  it('mounts the configuration of the stateful services from a stable directory, with its hash as a label (ADR-0100)', () => {
    for (const name of ['valkey', 'postgres', 'temporal', 'temporal-schema', 'temporal-init']) {
      const service = compose.services[name];
      const upper = name.startsWith('temporal') ? 'TEMPORAL' : name.toUpperCase();
      const binds = (service?.volumes ?? []).filter((v) => !/^[a-z-]+:/.test(v));
      expect(binds.length, `${name} mounts its configuration`).toBeGreaterThan(0);
      for (const bind of binds) {
        expect(bind, `${name}: no path relative to the release`).not.toMatch(/^\./);
        expect(bind.startsWith('${' + upper + '_CONFIG_DIR'), `${name}: ${bind}`).toBe(true);
      }
      expect(service?.labels?.['cdag.config-hash'], name).toContain(`${upper}_CONFIG_HASH`);
    }
  });

  it('publishes nothing but 80 and 443 on Caddy and the Temporal UI on loopback', () => {
    for (const [name, service] of services) {
      const ports = (service.ports ?? []).map(String);
      if (name === 'edge') {
        expect(ports.map((p) => p.replace(/\/tcp$/, '')).sort()).toEqual(['443:443', '80:80']);
      } else if (name === 'temporal-ui') {
        expect(ports).toEqual(['127.0.0.1:8233:8080']);
      } else {
        expect(ports, `${name} must not publish ports`).toEqual([]);
      }
    }
  });

  it.each(services)(
    '%s has memory limit, restart policy and a user that is not root',
    (name, s) => {
      expect(toMegabytes(s.mem_limit), `${name} mem_limit`).toBeGreaterThan(0);
      expect(s.restart, `${name} restart`).toBeTruthy();
      expect(s.user, `${name} user`).toMatch(/^\d+(:\d+)?$/);
      expect(s.user?.split(':')[0]).not.toBe('0');
    },
  );

  it.each(services)('%s has a healthcheck unless it is a one-shot job', (name, s) => {
    if (ONE_SHOT.has(name)) {
      expect(s.restart).toBe('no');
      return;
    }
    expect(s.healthcheck?.test, `${name} healthcheck`).toBeTruthy();
    expect(s.healthcheck?.disable).not.toBe(true);
    expect(s.restart).toBe('unless-stopped');
  });

  it('keeps the sum of the limits at 6 GB or less (FR-017, SC-010)', () => {
    const total = services.reduce((sum, [, s]) => sum + toMegabytes(s.mem_limit), 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(6 * 1024);
  });

  it('pins third-party images by digest and takes ours from a variable', () => {
    const own: Record<string, string> = {
      edge: '${EDGE_IMAGE:?',
      api: '${API_IMAGE:?',
      worker: '${WORKER_IMAGE:?',
      migrator: '${MIGRATOR_IMAGE:?',
    };
    for (const [name, s] of services) {
      const image = s.image ?? '';
      if (own[name]) {
        expect(image.startsWith(own[name]), `${name} image`).toBe(true);
        expect(image).not.toMatch(/:latest/);
      } else {
        expect(image, `${name} image`).toMatch(/@sha256:[0-9a-f]{64}$/);
        expect(image.toLowerCase()).not.toContain(':latest');
      }
    }
  });

  it('leaves PostgreSQL and Valkey without a plain-text port and on the internal network', () => {
    for (const name of ['postgres', 'valkey', 'temporal']) {
      const declared = compose.services[name]?.networks ?? {};
      const networks = Array.isArray(declared) ? declared : Object.keys(declared);
      expect(networks, `${name} networks`).toEqual(['backend']);
    }
    expect(compose.networks?.backend?.internal).toBe(true);
  });

  it('rotates the logs of every service', () => {
    for (const [name, s] of services) {
      const options = s.logging?.options ?? {};
      expect(options['max-size'], `${name} max-size`).toBeTruthy();
      expect(options['max-file'], `${name} max-file`).toBeTruthy();
    }
  });

  it('gives every file secret through `secrets` and never an inline password', () => {
    expect(Object.keys(compose.secrets ?? {}).length).toBeGreaterThan(0);
    for (const [name, secret] of Object.entries(compose.secrets ?? {})) {
      expect(secret.file, `${name} file`).toMatch(/^\$\{(SECRETS_DIR|PKI_DIR)(:\?[^}]*)?\}\//);
    }
    // A password or key is a path under /run/secrets or a variable, never a literal.
    expect(composeSource).not.toMatch(
      /(PASSWORD|SECRET|KEY)\s*:\s*['"]?(?!\/run\/secrets|\$\{)[A-Za-z0-9+/=]{16,}/,
    );
    expect(composeSource).not.toMatch(/_dev_only|local_dev_only/);
  });

  it('configures the application only with the *_FILE variables of the production contract', () => {
    for (const name of ['api', 'worker']) {
      const environment = JSON.stringify(compose.services[name]?.environment ?? {});
      expect(environment).toContain('NODE_ENV');
      expect(environment).toContain('DATABASE_PASSWORD_FILE');
      expect(environment).toContain('VALKEY_PASSWORD_FILE');
      expect(environment).toContain('TEMPORAL_TLS_CA_FILE');
      expect(environment).toContain('rediss://');
      expect(environment).toContain('sslmode=verify-full');
      expect(environment).not.toMatch(/"(DATABASE_URL|VALKEY_URL)":"[^"]*:[^"@/]+@/);
    }
    expect(JSON.stringify(compose.services.api?.environment)).toContain('TRUSTED_PROXIES');
  });

  it('starts the application only after the migrations and the namespace exist', () => {
    expect(compose.services.api?.depends_on?.migrator?.condition).toBe(
      'service_completed_successfully',
    );
    expect(compose.services.worker?.depends_on?.['temporal-init']?.condition).toBe(
      'service_completed_successfully',
    );
  });

  it('lets Caddy bind 80 and 443 without root through the sysctl, not through root', () => {
    expect(composeSource).toContain('net.ipv4.ip_unprivileged_port_start=0');
    expect(compose.services.edge?.user).toBe('10001:10001');
  });

  it('drops every capability of the services whose image allows it', () => {
    for (const name of ['edge', 'api', 'worker', 'migrator']) {
      expect(compose.services[name]?.cap_drop, `${name} cap_drop`).toEqual(['ALL']);
    }
  });
});

describe('Data stores of production (T033..T035)', () => {
  it('gives Valkey exactly the commands pinned by the ACL test of the application', () => {
    const pinned = read('apps/api/test/integration/valkey-acl.test.ts');
    const block = /VALKEY_ALLOWED_COMMANDS = \[([\s\S]*?)\] as const/.exec(pinned)?.[1] ?? '';
    const expected = [...block.matchAll(/'([a-z]+)'/g)].map((match) => match[1] ?? '').sort();
    expect(expected.length).toBeGreaterThan(10);
    const entrypoint = read('deploy/valkey/entrypoint.sh');
    const listed = /commands="([^"]+)"/.exec(entrypoint)?.[1] ?? '';
    expect(listed.split(/\s+/).filter(Boolean).sort()).toEqual(expected);
    expect(entrypoint).toContain('user default off');
    expect(entrypoint).toContain('-@all');
    expect(entrypoint).toContain('&run:*');
  });

  it('runs Valkey with TLS only, bounded memory and no eviction', () => {
    const conf = code(read('deploy/valkey/valkey.conf'));
    expect(conf).toMatch(/^port 0$/m);
    expect(conf).toMatch(/^tls-port 6379$/m);
    expect(conf).toMatch(/^maxmemory 128mb$/m);
    expect(conf).toMatch(/^maxmemory-policy noeviction$/m);
    expect(conf).toMatch(/^aclfile /m);
    // 128 MB of data fit in the 192 MB limit of the container.
    expect(toMegabytes(compose.services.valkey?.mem_limit)).toBeGreaterThan(128);
  });

  it('runs PostgreSQL with TLS and SCRAM, and pg_hba.conf has only hostssl lines', () => {
    const conf = code(read('deploy/postgres/postgresql.conf'));
    expect(conf).toMatch(/^ssl = on$/m);
    expect(conf).toMatch(/^password_encryption = scram-sha-256$/m);
    const lines = code(read('deploy/postgres/pg_hba.conf'))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line, line).toMatch(/^(local|hostssl)\s/);
      expect(line, line).not.toMatch(/\btrust\b|\bpassword\b|\bmd5\b/);
      if (line.startsWith('hostssl')) expect(line).toMatch(/scram-sha-256$/);
    }
    expect(lines.some((line) => /^host\s|^hostnossl\s/.test(line))).toBe(false);
  });

  it('creates the roles from secret files, with no password in the script', () => {
    const script = read('deploy/postgres/initdb/10-roles.sh');
    expect(script).toContain('/run/secrets/');
    expect(script).toContain('NOBYPASSRLS');
    expect(script).not.toMatch(/PASSWORD\s+'[^']+'/);
    expect(script).not.toMatch(/_dev_only/);
  });

  it('configures Temporal with mTLS on the frontend, PostgreSQL over TLS and short retention', () => {
    const template = read('deploy/temporal/production.template.yaml');
    expect(template).toMatch(/requireClientAuth:\s*true/);
    expect(template).toMatch(/pluginName:\s*postgres12/);
    expect(template).toContain('temporal_visibility');
    expect(template).toMatch(/enableHostVerification:\s*true/);
    expect(template).not.toMatch(/password:\s*["']?(?!__)[^\s"']+/);
    const init = read('deploy/temporal/init.sh');
    expect(init).toContain('CorrelationId');
    expect(init).toMatch(/TEMPORAL_RETENTION:-(\d+)h/);
    const hours = Number(/TEMPORAL_RETENTION:-(\d+)h/.exec(init)?.[1]);
    expect(hours).toBeLessThanOrEqual(168);
  });
});

describe('Temporal poller limit', () => {
  const worker = read('apps/worker/src/worker.ts');
  const constant = (name: string): number =>
    Number(new RegExp(`${name} = (\\d+);`).exec(worker)?.[1]);
  const dynamic = read('deploy/temporal/dynamicconfig.yaml');
  const limit = Number(/frontend\.namespaceCount:\s+- value: (\d+)/.exec(dynamic)?.[1]);

  it('pins the polls of every Worker the process creates', () => {
    expect(worker.match(/Worker\.create\(/g)).toHaveLength(3);
    expect(worker.match(/maxConcurrentActivityTaskPolls: ACTIVITY_TASK_POLLS/g)).toHaveLength(3);
    expect(worker.match(/maxConcurrentWorkflowTaskPolls: WORKFLOW_TASK_POLLS/g)).toHaveLength(1);
  });

  it('keeps frontend.namespaceCount above the pollers the worker opens, with margin', () => {
    const polls = constant('WORKFLOW_TASK_POLLS') + 3 * constant('ACTIVITY_TASK_POLLS');
    expect(polls).toBeGreaterThan(0);
    expect(limit).toBeGreaterThanOrEqual(polls * 2);
  });
});
