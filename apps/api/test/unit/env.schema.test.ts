import { describe, expect, it } from 'vitest';
import { InvalidConfigError, parseEnv } from '../../src/config/env.schema';

const VALID_ENV = {
  WEB_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: 'postgres://user:super-secret-password@127.0.0.1:5432/db',
  VALKEY_URL: 'redis://127.0.0.1:6379',
  TEMPORAL_ADDRESS: '127.0.0.1:7233',
  TEMPORAL_TASK_QUEUE: 'cognitive-dag',
};

describe('API environment validation', () => {
  it('accepts a valid environment and applies defaults', () => {
    const config = parseEnv(VALID_ENV);
    expect(config.API_PORT).toBe(3000);
    expect(config.BODY_LIMIT).toBe('100kb');
    expect(config.TEMPORAL_NAMESPACE).toBe('default');
  });

  it('names a missing variable', () => {
    const { TEMPORAL_ADDRESS: _missing, ...env } = VALID_ENV;
    expect(() => parseEnv(env)).toThrow(InvalidConfigError);
    expect(() => parseEnv(env)).toThrow(/TEMPORAL_ADDRESS/);
  });

  it('names an invalid variable without revealing any value', () => {
    const env = { ...VALID_ENV, DATABASE_URL: 'mysql://user:super-secret-password@host/db' };
    try {
      parseEnv(env);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidConfigError);
      expect((error as InvalidConfigError).variables).toEqual(['DATABASE_URL']);
      expect((error as Error).message).not.toContain('super-secret-password');
    }
  });

  it('rejects an invalid body limit', () => {
    expect(() => parseEnv({ ...VALID_ENV, BODY_LIMIT: 'unlimited' })).toThrow(/BODY_LIMIT/);
  });
});
