import { describe, expect, it } from 'vitest';
import { InvalidConfigError, parseEnv } from '../../src/config/env.schema';

const VALID_ENV = {
  TEMPORAL_ADDRESS: '127.0.0.1:7233',
  TEMPORAL_TASK_QUEUE: 'cognitive-dag',
};

describe('worker environment validation', () => {
  it('accepts a valid environment and applies defaults', () => {
    const config = parseEnv(VALID_ENV);
    expect(config.WORKER_HEALTH_PORT).toBe(3001);
    expect(config.PING_ACTIVITY_DELAY_MS).toBe(0);
  });

  it('names a missing variable without revealing values', () => {
    try {
      parseEnv({ TEMPORAL_TASK_QUEUE: 'cognitive-dag' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidConfigError);
      expect((error as InvalidConfigError).variables).toEqual(['TEMPORAL_ADDRESS']);
      expect((error as Error).message).not.toContain('cognitive-dag');
    }
  });

  it('rejects an out-of-range health port', () => {
    expect(() => parseEnv({ ...VALID_ENV, WORKER_HEALTH_PORT: '70000' })).toThrow(
      /WORKER_HEALTH_PORT/,
    );
  });
});
