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

describe('worker LLM variables (F5, research R2, R4, R6, R13, R14)', () => {
  it('defaults to the fake provider, enabled, with the limits of the research', () => {
    const config = parseEnv(VALID_ENV);
    expect(config.LLM_PROVIDER).toBe('fake');
    expect(config.LLM_ENABLED).toBe(true);
    expect(config.LLM_MAX_TOKENS_PER_RUN).toBe(50_000);
    expect(config.LLM_MAX_TOKENS_PER_ORG_DAY).toBe(500_000);
    expect(config.LLM_MAX_INPUT_CHARS).toBe(20_000);
    expect(config.TEMPORAL_LLM_TASK_QUEUE).toBe('cognitive-dag-llm');
    expect(config.LLM_MAX_CONCURRENT_ACTIVITIES).toBe(4);
    expect(config.llmModelRateLimit).toEqual({ capacity: 15, refillPerSecond: 0.25 });
    expect(config.GEMINI_API_KEY).toBeUndefined();
  });

  it('does not need a key with the fake provider, even if it is empty', () => {
    expect(() => parseEnv({ ...VALID_ENV, GEMINI_API_KEY: '' })).not.toThrow();
  });

  it('requires the key with the gemini provider and names only the variable', () => {
    for (const GEMINI_API_KEY of [undefined, '']) {
      try {
        parseEnv({ ...VALID_ENV, LLM_PROVIDER: 'gemini', GEMINI_API_KEY });
        expect.unreachable();
      } catch (error) {
        expect((error as InvalidConfigError).variables).toEqual(['GEMINI_API_KEY']);
      }
    }
  });

  it('accepts the gemini provider with a key and never echoes it on another failure', () => {
    const key = 'AIzaSy-not-a-real-key';
    expect(
      parseEnv({ ...VALID_ENV, LLM_PROVIDER: 'gemini', GEMINI_API_KEY: key }).LLM_PROVIDER,
    ).toBe('gemini');
    try {
      parseEnv({
        ...VALID_ENV,
        LLM_PROVIDER: 'gemini',
        GEMINI_API_KEY: key,
        LLM_MAX_INPUT_CHARS: '0',
      });
      expect.unreachable();
    } catch (error) {
      expect((error as InvalidConfigError).variables).toEqual(['LLM_MAX_INPUT_CHARS']);
      expect((error as Error).message).not.toContain(key);
    }
  });

  it('rejects an unknown provider', () => {
    expect(() => parseEnv({ ...VALID_ENV, LLM_PROVIDER: 'openai' })).toThrow(/LLM_PROVIDER/);
  });

  it('reads LLM_ENABLED as a boolean', () => {
    expect(parseEnv({ ...VALID_ENV, LLM_ENABLED: 'false' }).LLM_ENABLED).toBe(false);
    expect(parseEnv({ ...VALID_ENV, LLM_ENABLED: 'true' }).LLM_ENABLED).toBe(true);
    expect(() => parseEnv({ ...VALID_ENV, LLM_ENABLED: 'maybe' })).toThrow(/LLM_ENABLED/);
  });

  it('reads the model of each node type', () => {
    const config = parseEnv({
      ...VALID_ENV,
      LLM_MODEL_CLASSIFY: 'a',
      LLM_MODEL_EXTRACT: 'b',
      LLM_MODEL_GENERATE: 'c',
    });
    expect(config.llmModels).toEqual({
      'llm.classify': 'a',
      'llm.extract': 'b',
      'llm.generate': 'c',
    });
  });

  it('reads the prices and lists the models that have none (cost 0 and a warning)', () => {
    const config = parseEnv({
      ...VALID_ENV,
      LLM_MODEL_CLASSIFY: 'a',
      LLM_MODEL_EXTRACT: 'a',
      LLM_MODEL_GENERATE: 'c',
      LLM_PRICES: 'a:100000:400000',
    });
    expect(config.llmPrices.get('a')).toEqual({ input: 100_000, output: 400_000 });
    expect(config.llmModelsWithoutPrice).toEqual(['c']);
  });

  it('rejects malformed prices naming only the variable', () => {
    try {
      parseEnv({ ...VALID_ENV, LLM_PRICES: 'broken-value' });
      expect.unreachable();
    } catch (error) {
      expect((error as InvalidConfigError).variables).toEqual(['LLM_PRICES']);
      expect((error as Error).message).not.toContain('broken-value');
    }
  });

  it.each([
    ['LLM_MAX_TOKENS_PER_RUN', '0'],
    ['LLM_MAX_TOKENS_PER_ORG_DAY', '-1'],
    ['LLM_MAX_INPUT_CHARS', 'abc'],
    ['LLM_MAX_CONCURRENT_ACTIVITIES', '0'],
    ['LLM_MAX_CONCURRENT_ACTIVITIES', '1000'],
    ['TEMPORAL_LLM_TASK_QUEUE', ''],
  ])('rejects %s=%s', (name, value) => {
    expect(() => parseEnv({ ...VALID_ENV, [name]: value })).toThrow(new RegExp(name));
  });

  it('reads the global per-model rate limit and does not take it for a node type', () => {
    const config = parseEnv({
      ...VALID_ENV,
      RATE_LIMIT_LLM_MODEL: 'capacity:30,refillPerSecond:1',
      RATE_LIMIT_LLM_CLASSIFY: 'capacity:5,refillPerSecond:1',
    });
    expect(config.llmModelRateLimit).toEqual({ capacity: 30, refillPerSecond: 1 });
    expect(config.rateLimits).toEqual({ 'llm.classify': { capacity: 5, refillPerSecond: 1 } });
  });

  it('rejects a malformed global rate limit', () => {
    expect(() =>
      parseEnv({ ...VALID_ENV, RATE_LIMIT_LLM_MODEL: 'capacity:0,refillPerSecond:1' }),
    ).toThrow(/RATE_LIMIT_LLM_MODEL/);
  });
});
