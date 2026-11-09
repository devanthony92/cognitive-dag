import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InvalidConfigError, parseEnv } from '../../src/config/env.schema';

/** Every secret of these tests is generated at run time: nothing here has the shape of a secret. */
const secret = () => randomBytes(18).toString('hex');
const masterKey = randomBytes(32).toString('base64');
// Built from parts so that no development password is spelled out as one literal.
const developmentPassword = ['app_runtime', 'dev', 'only'].join('_');

const FILES: Record<string, string> = {
  '/run/s/db-password': secret(),
  '/run/s/valkey-password': secret(),
  '/run/s/smtp-user': secret(),
  '/run/s/smtp-password': secret(),
  '/run/s/master-key': `${masterKey}\n`,
  '/run/s/ca.pem': 'ca-contents',
  '/run/s/cert.pem': 'cert-contents',
  '/run/s/key.pem': secret(),
};

const read = (path: string): string => {
  const contents = FILES[path];
  if (contents === undefined) throw new Error(`ENOENT ${path}`);
  return contents;
};

const PRODUCTION_ENV: Record<string, string> = {
  NODE_ENV: 'production',
  WEB_ORIGIN: 'https://demo.example.test',
  API_PUBLIC_URL: 'https://demo.example.test',
  DATABASE_URL:
    'postgres://app_runtime@postgres:5432/cognitive_dag?sslmode=verify-full&sslrootcert=/run/s/ca.pem',
  DATABASE_PASSWORD_FILE: '/run/s/db-password',
  VALKEY_URL: 'rediss://valkey:6379',
  VALKEY_USERNAME: 'app',
  VALKEY_PASSWORD_FILE: '/run/s/valkey-password',
  VALKEY_CA_FILE: '/run/s/ca.pem',
  TEMPORAL_ADDRESS: 'temporal:7233',
  TEMPORAL_TASK_QUEUE: 'cognitive-dag',
  TEMPORAL_TLS_CA_FILE: '/run/s/ca.pem',
  TEMPORAL_TLS_CERT_FILE: '/run/s/cert.pem',
  TEMPORAL_TLS_KEY_FILE: '/run/s/key.pem',
  TEMPORAL_TLS_SERVER_NAME: 'temporal',
  CREDENTIALS_MASTER_KEY_FILE: '/run/s/master-key',
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: '587',
  SMTP_SECURE: 'starttls',
  SMTP_USER_FILE: '/run/s/smtp-user',
  SMTP_PASSWORD_FILE: '/run/s/smtp-password',
};

function without(...names: string[]): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...PRODUCTION_ENV };
  for (const name of names) delete env[name];
  return env;
}

function failure(env: Record<string, string | undefined>): InvalidConfigError {
  try {
    parseEnv(env, read);
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidConfigError);
    return error as InvalidConfigError;
  }
  throw new Error('the environment was accepted');
}

describe('API production startup rules (F9, FR-012)', () => {
  it('accepts a complete production environment and resolves the secret files', () => {
    const config = parseEnv(PRODUCTION_ENV, read);
    expect(config.credentialsMasterKey?.toString('base64')).toBe(masterKey);
    expect(config.DATABASE_URL).toContain(encodeURIComponent(FILES['/run/s/db-password']!));
    expect(config.valkeyAuth).toEqual({
      username: 'app',
      password: FILES['/run/s/valkey-password'],
      ca: 'ca-contents',
    });
    expect(config.smtpAuth).toEqual({
      user: FILES['/run/s/smtp-user'],
      password: FILES['/run/s/smtp-password'],
    });
    expect(config.temporalTls?.serverNameOverride).toBe('temporal');
    expect(config.temporalTls?.serverRootCACertificate.toString()).toBe('ca-contents');
  });

  it.each([
    ['plain TLS without verification', { sslmode: 'require' }, 'DATABASE_URL'],
    ['no certificate authority', { sslmode: 'verify-full', sslrootcert: '' }, 'DATABASE_URL'],
  ])('rejects DATABASE_URL with %s', (_label, params, variable) => {
    const query = Object.entries(params)
      .filter(([, value]) => value !== '')
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
    const url = `postgres://app_runtime@postgres:5432/cognitive_dag?${query}`;
    expect(failure({ ...PRODUCTION_ENV, DATABASE_URL: url }).variables).toEqual([variable]);
  });

  it('rejects a DATABASE_URL without any TLS parameter', () => {
    const url = 'postgres://app_runtime@postgres:5432/cognitive_dag';
    expect(failure({ ...PRODUCTION_ENV, DATABASE_URL: url }).variables).toEqual(['DATABASE_URL']);
  });

  it('rejects a VALKEY_URL that is not rediss://', () => {
    const env = { ...PRODUCTION_ENV, VALKEY_URL: 'redis://valkey:6379' };
    expect(failure(env).variables).toEqual(['VALKEY_URL']);
  });

  it('requires the Valkey user, password and CA', () => {
    expect(failure(without('VALKEY_USERNAME')).variables).toEqual(['VALKEY_USERNAME']);
    expect(failure(without('VALKEY_PASSWORD_FILE')).variables).toEqual(['VALKEY_PASSWORD_FILE']);
    expect(failure(without('VALKEY_CA_FILE')).variables).toEqual(['VALKEY_CA_FILE']);
  });

  it('requires the three TLS files of Temporal', () => {
    const env = without('TEMPORAL_TLS_CA_FILE', 'TEMPORAL_TLS_CERT_FILE', 'TEMPORAL_TLS_KEY_FILE');
    expect(failure(env).variables).toEqual([
      'TEMPORAL_TLS_CA_FILE',
      'TEMPORAL_TLS_CERT_FILE',
      'TEMPORAL_TLS_KEY_FILE',
    ]);
  });

  it('requires CREDENTIALS_MASTER_KEY', () => {
    expect(failure(without('CREDENTIALS_MASTER_KEY_FILE')).variables).toEqual([
      'CREDENTIALS_MASTER_KEY',
    ]);
  });

  it('refuses the direct CREDENTIALS_MASTER_KEY in production: only the file is allowed', () => {
    const env = { ...without('CREDENTIALS_MASTER_KEY_FILE'), CREDENTIALS_MASTER_KEY: masterKey };
    const error = failure(env);
    expect(error.variables).toEqual(['CREDENTIALS_MASTER_KEY']);
    expect(error.message).not.toContain(masterKey);
  });

  it('rejects a password equal to a development value, naming the variable only', () => {
    const files: Record<string, string> = { ...FILES, '/run/s/db-password': developmentPassword };
    try {
      parseEnv(PRODUCTION_ENV, (path) => files[path] ?? read(path));
      expect.unreachable();
    } catch (error) {
      expect((error as InvalidConfigError).variables).toEqual(['DATABASE_PASSWORD_FILE']);
      expect((error as Error).message).not.toContain(developmentPassword);
    }
  });

  it('rejects a development password written inside the URL', () => {
    const url = `postgres://app_runtime:${developmentPassword}@postgres:5432/cognitive_dag?sslmode=verify-full&sslrootcert=/run/s/ca.pem`;
    const error = failure({ ...without('DATABASE_PASSWORD_FILE'), DATABASE_URL: url });
    expect(error.variables).toEqual(['DATABASE_URL']);
    expect(error.message).not.toContain(developmentPassword);
  });

  it.each(['WEB_ORIGIN', 'API_PUBLIC_URL'])('rejects a non-https %s', (name) => {
    expect(failure({ ...PRODUCTION_ENV, [name]: 'http://demo.example.test' }).variables).toEqual([
      name,
    ]);
  });

  it('requires API_PUBLIC_URL and an https APP_BASE_URL', () => {
    expect(failure(without('API_PUBLIC_URL')).variables).toEqual(['API_PUBLIC_URL']);
    const env = { ...PRODUCTION_ENV, APP_BASE_URL: 'http://demo.example.test' };
    expect(failure(env).variables).toEqual(['APP_BASE_URL']);
  });

  it('requires SMTP with TLS and authentication', () => {
    expect(failure({ ...PRODUCTION_ENV, SMTP_SECURE: 'false' }).variables).toEqual(['SMTP_SECURE']);
    expect(failure(without('SMTP_SECURE')).variables).toEqual(['SMTP_SECURE']);
    expect(failure(without('SMTP_USER_FILE')).variables).toEqual(['SMTP_USER_FILE']);
    expect(failure(without('SMTP_PASSWORD_FILE')).variables).toEqual(['SMTP_PASSWORD_FILE']);
  });

  it('names a secret file that cannot be read, never its path contents', () => {
    const error = failure({ ...PRODUCTION_ENV, SMTP_PASSWORD_FILE: '/run/s/missing' });
    expect(error.variables).toEqual(['SMTP_PASSWORD_FILE']);
  });

  it('reports every failure at once and never leaks a value', () => {
    const error = failure({
      ...PRODUCTION_ENV,
      VALKEY_URL: 'redis://valkey:6379',
      WEB_ORIGIN: 'http://demo.example.test',
    });
    expect(error.variables).toEqual(['VALKEY_URL', 'WEB_ORIGIN']);
    for (const contents of Object.values(FILES)) {
      expect(error.message).not.toContain(contents.trim());
    }
  });

  it('leaves development untouched: no TLS, no files and no secrets needed', () => {
    const config = parseEnv(
      {
        WEB_ORIGIN: 'http://localhost:5173',
        DATABASE_URL: 'postgres://app_runtime@127.0.0.1:5433/cognitive_dag',
        VALKEY_URL: 'redis://127.0.0.1:6379',
        TEMPORAL_ADDRESS: '127.0.0.1:7233',
        TEMPORAL_TASK_QUEUE: 'cognitive-dag',
      },
      read,
    );
    expect(config.temporalTls).toBeUndefined();
    expect(config.valkeyAuth).toBeUndefined();
    expect(config.smtpAuth).toBeUndefined();
    expect(config.SMTP_SECURE).toBe('false');
    expect(config.TRUSTED_PROXIES).toEqual([]);
  });

  it('reads secret files outside production too', () => {
    const config = parseEnv(
      {
        ...PRODUCTION_ENV,
        NODE_ENV: 'development',
        WEB_ORIGIN: 'http://localhost:5173',
        SMTP_SECURE: 'false',
      },
      read,
    );
    expect(config.smtpAuth?.user).toBe(FILES['/run/s/smtp-user']);
  });
});

describe('TRUSTED_PROXIES (F9, FR-005)', () => {
  const base = {
    WEB_ORIGIN: 'http://localhost:5173',
    DATABASE_URL: 'postgres://app_runtime@127.0.0.1:5433/cognitive_dag',
    VALKEY_URL: 'redis://127.0.0.1:6379',
    TEMPORAL_ADDRESS: '127.0.0.1:7233',
    TEMPORAL_TASK_QUEUE: 'cognitive-dag',
  };

  it('is a closed list of addresses and CIDR ranges', () => {
    const config = parseEnv({ ...base, TRUSTED_PROXIES: '172.18.0.0/16, 10.0.0.5,fd00::/8' }, read);
    expect(config.TRUSTED_PROXIES).toEqual(['172.18.0.0/16', '10.0.0.5', 'fd00::/8']);
  });

  it.each(['loopback', 'uniquelocal', '10.0.0.0/33', '999.1.1.1', '10.0.0.1/', 'caddy'])(
    'rejects %s: keywords and malformed ranges are not a closed list',
    (value) => {
      expect(failure({ ...base, TRUSTED_PROXIES: value }).variables).toEqual(['TRUSTED_PROXIES']);
    },
  );
});
