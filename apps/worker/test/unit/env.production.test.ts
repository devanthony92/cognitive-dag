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
  '/run/s/gemini-key': `${secret()}\n`,
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
  LLM_PROVIDER: 'gemini',
  GEMINI_API_KEY_FILE: '/run/s/gemini-key',
  APP_BASE_URL: 'https://demo.example.test',
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

describe('worker production startup rules (F9, FR-012)', () => {
  it('accepts a complete production environment and resolves the secret files', () => {
    const config = parseEnv(PRODUCTION_ENV, read);
    expect(config.credentialsMasterKey?.toString('base64')).toBe(masterKey);
    expect(config.DATABASE_URL).toContain(encodeURIComponent(FILES['/run/s/db-password']!));
    expect(config.GEMINI_API_KEY).toBe(FILES['/run/s/gemini-key']!.trim());
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
  });

  it('rejects a DATABASE_URL that does not require verified TLS', () => {
    const url = 'postgres://app_runtime@postgres:5432/cognitive_dag?sslmode=require';
    expect(failure({ ...PRODUCTION_ENV, DATABASE_URL: url }).variables).toEqual(['DATABASE_URL']);
    const plain = 'postgres://app_runtime@postgres:5432/cognitive_dag';
    expect(failure({ ...PRODUCTION_ENV, DATABASE_URL: plain }).variables).toEqual(['DATABASE_URL']);
  });

  it('rejects a VALKEY_URL that is not rediss://', () => {
    expect(failure({ ...PRODUCTION_ENV, VALKEY_URL: 'redis://valkey:6379' }).variables).toEqual([
      'VALKEY_URL',
    ]);
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

  it('requires CREDENTIALS_MASTER_KEY and refuses it as a direct variable', () => {
    expect(failure(without('CREDENTIALS_MASTER_KEY_FILE')).variables).toEqual([
      'CREDENTIALS_MASTER_KEY',
    ]);
    const direct = { ...without('CREDENTIALS_MASTER_KEY_FILE'), CREDENTIALS_MASTER_KEY: masterKey };
    const error = failure(direct);
    expect(error.variables).toEqual(['CREDENTIALS_MASTER_KEY']);
    expect(error.message).not.toContain(masterKey);
  });

  it('requires the Gemini key from a file when the provider is gemini', () => {
    expect(failure(without('GEMINI_API_KEY_FILE')).variables).toEqual(['GEMINI_API_KEY_FILE']);
    const direct = { ...without('GEMINI_API_KEY_FILE'), GEMINI_API_KEY: secret() };
    expect(failure(direct).variables).toEqual(['GEMINI_API_KEY']);
  });

  it('does not need a Gemini key with the fake provider', () => {
    const config = parseEnv({ ...without('GEMINI_API_KEY_FILE'), LLM_PROVIDER: 'fake' }, read);
    expect(config.GEMINI_API_KEY).toBeUndefined();
  });

  it('rejects a password equal to a development value, naming the variable only', () => {
    const files: Record<string, string> = {
      ...FILES,
      '/run/s/valkey-password': developmentPassword,
    };
    try {
      parseEnv(PRODUCTION_ENV, (path) => files[path] ?? read(path));
      expect.unreachable();
    } catch (error) {
      expect((error as InvalidConfigError).variables).toEqual(['VALKEY_PASSWORD_FILE']);
      expect((error as Error).message).not.toContain(developmentPassword);
    }
  });

  it('rejects a development password written inside the URL', () => {
    const url = `postgres://app_runtime:${developmentPassword}@postgres:5432/cognitive_dag?sslmode=verify-full&sslrootcert=/run/s/ca.pem`;
    const error = failure({ ...without('DATABASE_PASSWORD_FILE'), DATABASE_URL: url });
    expect(error.variables).toEqual(['DATABASE_URL']);
    expect(error.message).not.toContain(developmentPassword);
  });

  it('requires an https APP_BASE_URL when it is set', () => {
    const env = { ...PRODUCTION_ENV, APP_BASE_URL: 'http://demo.example.test' };
    expect(failure(env).variables).toEqual(['APP_BASE_URL']);
  });

  it('requires SMTP with TLS and authentication', () => {
    expect(failure({ ...PRODUCTION_ENV, SMTP_SECURE: 'false' }).variables).toEqual(['SMTP_SECURE']);
    expect(failure(without('SMTP_USER_FILE')).variables).toEqual(['SMTP_USER_FILE']);
    expect(failure(without('SMTP_PASSWORD_FILE')).variables).toEqual(['SMTP_PASSWORD_FILE']);
  });

  it('names a secret file that cannot be read', () => {
    const env = { ...PRODUCTION_ENV, GEMINI_API_KEY_FILE: '/run/s/missing' };
    expect(failure(env).variables).toEqual(['GEMINI_API_KEY_FILE']);
  });

  it('keeps refusing HTTP_TEST_ALLOW_LOOPBACK in production', () => {
    expect(failure({ ...PRODUCTION_ENV, HTTP_TEST_ALLOW_LOOPBACK: 'true' }).variables).toEqual([
      'HTTP_TEST_ALLOW_LOOPBACK',
    ]);
  });

  it('reports every failure at once and never leaks a value', () => {
    const error = failure({
      ...PRODUCTION_ENV,
      VALKEY_URL: 'redis://valkey:6379',
      SMTP_SECURE: 'false',
    });
    expect(error.variables).toEqual(['SMTP_SECURE', 'VALKEY_URL']);
    for (const contents of Object.values(FILES)) {
      expect(error.message).not.toContain(contents.trim());
    }
  });

  it('leaves development untouched: no TLS, no files and no secrets needed', () => {
    const config = parseEnv(
      {
        TEMPORAL_ADDRESS: '127.0.0.1:7233',
        TEMPORAL_TASK_QUEUE: 'cognitive-dag',
        DATABASE_URL: 'postgres://app_runtime@127.0.0.1:5433/cognitive_dag',
        VALKEY_URL: 'redis://127.0.0.1:6379',
      },
      read,
    );
    expect(config.temporalTls).toBeUndefined();
    expect(config.valkeyAuth).toBeUndefined();
    expect(config.smtpAuth).toBeUndefined();
    expect(config.SMTP_SECURE).toBe('false');
  });
});
