import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseEnv, type InvalidConfigError } from '../../src/config/env.schema';

const VALID_ENV = {
  WEB_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: 'postgres://user:super-secret-password@127.0.0.1:5432/db',
  VALKEY_URL: 'redis://127.0.0.1:6379',
  TEMPORAL_ADDRESS: '127.0.0.1:7233',
  TEMPORAL_TASK_QUEUE: 'cognitive-dag',
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

describe('API variables of F7 (webhook and credentials)', () => {
  it('applies the defaults of the research', () => {
    const config = parseEnv(VALID_ENV);
    expect(config.WEBHOOK_MAX_BODY_BYTES).toBe(65_536);
    expect(config.WEBHOOK_TIMESTAMP_WINDOW_SECONDS).toBe(300);
    expect(config.TEMPORAL_HTTP_TASK_QUEUE).toBe('cognitive-dag-http');
    expect(config.credentialsMasterKey).toBeUndefined();
  });

  it('reads custom limits', () => {
    const config = parseEnv({
      ...VALID_ENV,
      WEBHOOK_MAX_BODY_BYTES: '1024',
      WEBHOOK_TIMESTAMP_WINDOW_SECONDS: '60',
      TEMPORAL_HTTP_TASK_QUEUE: 'http-q',
    });
    expect(config.WEBHOOK_MAX_BODY_BYTES).toBe(1024);
    expect(config.WEBHOOK_TIMESTAMP_WINDOW_SECONDS).toBe(60);
    expect(config.TEMPORAL_HTTP_TASK_QUEUE).toBe('http-q');
  });

  it.each([
    ['WEBHOOK_MAX_BODY_BYTES', '0'],
    ['WEBHOOK_MAX_BODY_BYTES', '10485761'],
    ['WEBHOOK_TIMESTAMP_WINDOW_SECONDS', '0'],
    ['WEBHOOK_TIMESTAMP_WINDOW_SECONDS', '3601'],
    ['TEMPORAL_HTTP_TASK_QUEUE', ''],
  ])('rejects %s=%s naming only the variable', (name, value) => {
    expect(variablesOf({ ...VALID_ENV, [name]: value })).toEqual([name]);
  });

  it('exposes the master key as 32 bytes when it is valid', () => {
    const config = parseEnv({ ...VALID_ENV, CREDENTIALS_MASTER_KEY: masterKey });
    expect(config.credentialsMasterKey?.toString('base64')).toBe(masterKey);
  });

  it('does not need the master key outside production, but requires it in production', () => {
    expect(parseEnv({ ...VALID_ENV, NODE_ENV: 'test' }).credentialsMasterKey).toBeUndefined();
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
});
