import { describe, expect, it } from 'vitest';
import { InvalidConfigError, parseEnv } from '../../src/config/env.schema';

const VALID_ENV = {
  TEMPORAL_ADDRESS: '127.0.0.1:7233',
  TEMPORAL_TASK_QUEUE: 'cognitive-dag',
  DATABASE_URL: 'postgres://app_runtime:secret-pw@127.0.0.1:5433/cognitive_dag',
  VALKEY_URL: 'redis://127.0.0.1:6379',
};

describe('worker environment validation', () => {
  it('accepts a valid environment and applies defaults', () => {
    const config = parseEnv(VALID_ENV);
    expect(config.WORKER_HEALTH_PORT).toBe(3001);
    expect(config.PING_ACTIVITY_DELAY_MS).toBe(0);
  });

  it('names a missing variable without revealing values', () => {
    try {
      parseEnv({ ...VALID_ENV, TEMPORAL_ADDRESS: undefined });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidConfigError);
      expect((error as InvalidConfigError).variables).toEqual(['TEMPORAL_ADDRESS']);
      expect((error as Error).message).not.toContain('cognitive-dag');
    }
  });

  it.each(['DATABASE_URL', 'VALKEY_URL'])('fails closed without %s', (name) => {
    const { [name]: _removed, ...rest } = VALID_ENV as Record<string, string>;
    try {
      parseEnv(rest);
      expect.unreachable();
    } catch (error) {
      expect((error as InvalidConfigError).variables).toEqual([name]);
      expect((error as Error).message).not.toContain('secret-pw');
    }
  });

  it('rejects connection strings with the wrong scheme', () => {
    expect(() => parseEnv({ ...VALID_ENV, DATABASE_URL: 'mysql://x' })).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ ...VALID_ENV, VALKEY_URL: 'http://x' })).toThrow(/VALKEY_URL/);
  });

  it('rejects an out-of-range health port', () => {
    expect(() => parseEnv({ ...VALID_ENV, WORKER_HEALTH_PORT: '70000' })).toThrow(
      /WORKER_HEALTH_PORT/,
    );
  });
});

describe('worker rate limit variables', () => {
  it('has no limits by default', () => {
    expect(parseEnv(VALID_ENV).rateLimits).toEqual({});
  });

  it('reads RATE_LIMIT_<NODE_TYPE> by node type', () => {
    const config = parseEnv({
      ...VALID_ENV,
      RATE_LIMIT_MOCK_SERVICE: 'capacity:10,refillPerSecond:2.5',
    });
    expect(config.rateLimits).toEqual({
      'mock.service': { capacity: 10, refillPerSecond: 2.5 },
    });
  });

  it.each([
    'capacity:0,refillPerSecond:1',
    'capacity:10',
    'capacity:10,refillPerSecond:0',
    'capacity:abc,refillPerSecond:1',
    'capacity:10000000,refillPerSecond:1',
  ])('rejects the malformed value «%s», naming only the variable', (value) => {
    try {
      parseEnv({ ...VALID_ENV, RATE_LIMIT_MOCK_SERVICE: value });
      expect.unreachable();
    } catch (error) {
      expect((error as InvalidConfigError).variables).toEqual(['RATE_LIMIT_MOCK_SERVICE']);
      expect((error as Error).message).not.toContain(value);
    }
  });

  it('rejects a variable for a node type that does not exist', () => {
    expect(() =>
      parseEnv({ ...VALID_ENV, RATE_LIMIT_NOPE: 'capacity:1,refillPerSecond:1' }),
    ).toThrow(/RATE_LIMIT_NOPE/);
  });
});
