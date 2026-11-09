import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseEnv, type InvalidConfigError } from '../../src/config/env.schema';

const VALID_ENV = {
  TEMPORAL_ADDRESS: '127.0.0.1:7233',
  TEMPORAL_TASK_QUEUE: 'cognitive-dag',
  DATABASE_URL: 'postgres://app_runtime:secret-pw@127.0.0.1:5433/cognitive_dag',
  VALKEY_URL: 'redis://127.0.0.1:6379',
};

const masterKey = randomBytes(32).toString('base64');

function variablesOf(env: Record<string, string | undefined>): string[] {
  try {
    parseEnv(env);
  } catch (error) {
    return (error as InvalidConfigError).variables;
  }
  throw new Error('the environment was accepted');
}

describe('worker variables of F7 (triggers and HTTP)', () => {
  it('applies the defaults of the research', () => {
    const config = parseEnv(VALID_ENV);
    expect(config.TRIGGERS_ENABLED).toBe(true);
    expect(config.HTTP_ENABLED).toBe(true);
    expect(config.TEMPORAL_HTTP_TASK_QUEUE).toBe('cognitive-dag-http');
    expect(config.HTTP_MAX_CONCURRENT_ACTIVITIES).toBe(20);
    expect(config.HTTP_CB_FAILURES).toBe(5);
    expect(config.HTTP_CB_WINDOW_SECONDS).toBe(60);
    expect(config.HTTP_CB_COOLDOWN_SECONDS).toBe(30);
    expect(config.HTTP_CB_MAX_WAIT_SECONDS).toBe(120);
    expect(config.SCHEDULE_CATCHUP_WINDOW_SECONDS).toBe(3600);
    expect(config.APPROVAL_EMAIL_MAX_RECIPIENTS).toBe(20);
    expect(config.SMTP_HOST).toBe('127.0.0.1');
    expect(config.SMTP_PORT).toBe(1025);
    expect(config.HTTP_TEST_ALLOW_LOOPBACK).toBe(false);
    expect(config.credentialsMasterKey).toBeUndefined();
  });

  it('turns the kill switches off', () => {
    const config = parseEnv({ ...VALID_ENV, TRIGGERS_ENABLED: 'false', HTTP_ENABLED: 'false' });
    expect(config.TRIGGERS_ENABLED).toBe(false);
    expect(config.HTTP_ENABLED).toBe(false);
    expect(variablesOf({ ...VALID_ENV, HTTP_ENABLED: 'maybe' })).toEqual(['HTTP_ENABLED']);
  });

  it('reads the master key and exposes it as 32 bytes', () => {
    const config = parseEnv({ ...VALID_ENV, CREDENTIALS_MASTER_KEY: masterKey });
    expect(config.credentialsMasterKey?.toString('base64')).toBe(masterKey);
  });

  it('does not need the master key outside production', () => {
    expect(
      parseEnv({ ...VALID_ENV, NODE_ENV: 'development' }).credentialsMasterKey,
    ).toBeUndefined();
    expect(parseEnv({ ...VALID_ENV, NODE_ENV: 'test' }).credentialsMasterKey).toBeUndefined();
  });

  it('requires the master key in production, naming only the variable', () => {
    // The rest of the production rules (TLS, files, origins) is covered by env.production.test.ts.
    expect(variablesOf({ ...VALID_ENV, NODE_ENV: 'production' })).toContain(
      'CREDENTIALS_MASTER_KEY',
    );
    // In production the direct variable is refused as well: only the file is accepted.
    expect(
      variablesOf({ ...VALID_ENV, NODE_ENV: 'production', CREDENTIALS_MASTER_KEY: masterKey }),
    ).toContain('CREDENTIALS_MASTER_KEY');
  });

  it.each([
    ['16 bytes', randomBytes(16).toString('base64')],
    ['not base64', '!!!not-base64!!!'],
    ['hex', randomBytes(32).toString('hex')],
  ])('rejects a master key of %s without revealing it', (_name, value) => {
    try {
      parseEnv({ ...VALID_ENV, CREDENTIALS_MASTER_KEY: value });
      expect.unreachable();
    } catch (error) {
      expect((error as InvalidConfigError).variables).toEqual(['CREDENTIALS_MASTER_KEY']);
      expect((error as Error).message).not.toContain(value);
    }
  });

  it('allows the loopback escape hatch outside production', () => {
    expect(
      parseEnv({ ...VALID_ENV, HTTP_TEST_ALLOW_LOOPBACK: 'true' }).HTTP_TEST_ALLOW_LOOPBACK,
    ).toBe(true);
    expect(
      parseEnv({ ...VALID_ENV, NODE_ENV: 'test', HTTP_TEST_ALLOW_LOOPBACK: 'true' })
        .HTTP_TEST_ALLOW_LOOPBACK,
    ).toBe(true);
  });

  it.each(['true', 'false', '1'])(
    'refuses HTTP_TEST_ALLOW_LOOPBACK=%s in production: it must not be defined at all',
    (value) => {
      expect(
        variablesOf({
          ...VALID_ENV,
          NODE_ENV: 'production',
          CREDENTIALS_MASTER_KEY: masterKey,
          HTTP_TEST_ALLOW_LOOPBACK: value,
        }),
      ).toContain('HTTP_TEST_ALLOW_LOOPBACK');
    },
  );

  it('treats an empty HTTP_TEST_ALLOW_LOOPBACK as not defined', () => {
    const config = parseEnv({ ...VALID_ENV, HTTP_TEST_ALLOW_LOOPBACK: '' });
    expect(config.HTTP_TEST_ALLOW_LOOPBACK).toBe(false);
    expect(
      variablesOf({ ...VALID_ENV, NODE_ENV: 'production', HTTP_TEST_ALLOW_LOOPBACK: '' }),
    ).not.toContain('HTTP_TEST_ALLOW_LOOPBACK');
  });

  it.each([
    ['HTTP_MAX_CONCURRENT_ACTIVITIES', '0'],
    ['HTTP_MAX_CONCURRENT_ACTIVITIES', '101'],
    ['HTTP_CB_FAILURES', '0'],
    ['HTTP_CB_WINDOW_SECONDS', '0'],
    ['HTTP_CB_COOLDOWN_SECONDS', '-1'],
    ['HTTP_CB_MAX_WAIT_SECONDS', 'abc'],
    ['SCHEDULE_CATCHUP_WINDOW_SECONDS', '0'],
    ['APPROVAL_EMAIL_MAX_RECIPIENTS', '0'],
    ['APPROVAL_EMAIL_MAX_RECIPIENTS', '21'],
    ['SMTP_PORT', '70000'],
    ['TEMPORAL_HTTP_TASK_QUEUE', ''],
  ])('rejects %s=%s naming only the variable', (name, value) => {
    expect(variablesOf({ ...VALID_ENV, [name]: value })).toEqual([name]);
  });

  it('reads custom values', () => {
    const config = parseEnv({
      ...VALID_ENV,
      TEMPORAL_HTTP_TASK_QUEUE: 'http-q',
      HTTP_MAX_CONCURRENT_ACTIVITIES: '8',
      HTTP_CB_FAILURES: '3',
      HTTP_CB_WINDOW_SECONDS: '30',
      HTTP_CB_COOLDOWN_SECONDS: '10',
      HTTP_CB_MAX_WAIT_SECONDS: '60',
      SCHEDULE_CATCHUP_WINDOW_SECONDS: '600',
      APPROVAL_EMAIL_MAX_RECIPIENTS: '5',
      SMTP_HOST: 'mail.internal',
      SMTP_PORT: '587',
      MAIL_FROM: 'CognitiveDAG <ops@example.com>',
      APP_BASE_URL: 'https://app.example.com',
    });
    expect(config).toMatchObject({
      TEMPORAL_HTTP_TASK_QUEUE: 'http-q',
      HTTP_MAX_CONCURRENT_ACTIVITIES: 8,
      HTTP_CB_FAILURES: 3,
      HTTP_CB_WINDOW_SECONDS: 30,
      HTTP_CB_COOLDOWN_SECONDS: 10,
      HTTP_CB_MAX_WAIT_SECONDS: 60,
      SCHEDULE_CATCHUP_WINDOW_SECONDS: 600,
      APPROVAL_EMAIL_MAX_RECIPIENTS: 5,
      SMTP_HOST: 'mail.internal',
      SMTP_PORT: 587,
      MAIL_FROM: 'CognitiveDAG <ops@example.com>',
      APP_BASE_URL: 'https://app.example.com',
    });
  });
});
