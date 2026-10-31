import { describe, expect, it } from 'vitest';
import {
  NODE_CATALOG,
  NODE_TYPES,
  RETRY_LIMITS,
  resolveRetryPolicy,
  supportsRetry,
  validateDefinition,
} from '../../src/index.js';
import { def, edge, node, trigger } from '../helpers.js';

const withRetry = (retry: unknown, type: 'mock.service' | 'logic.merge' = 'mock.service') => {
  const n = node('a', type);
  return def([trigger(), { ...n, retry }], [edge('trigger', 'a')]);
};

describe('retry limits (FR-006)', () => {
  it('bounds attempts, time per attempt and initial interval', () => {
    expect(RETRY_LIMITS).toEqual({
      maxAttempts: { min: 1, max: 10 },
      timeoutSeconds: { min: 1, max: 120 },
      initialIntervalMs: { min: 100, max: 30_000 },
    });
  });
});

describe('retry setting on nodes', () => {
  it('is supported only by nodes with effects', () => {
    expect(NODE_TYPES.filter(supportsRetry)).toEqual(['mock.service']);
  });

  it('declares defaults for mock.service (FR-005)', () => {
    expect(resolveRetryPolicy('mock.service', undefined)).toEqual({
      maxAttempts: 3,
      timeoutSeconds: 30,
      initialIntervalMs: 1000,
    });
  });

  it('has no policy for nodes without effects', () => {
    expect(resolveRetryPolicy('logic.merge', undefined)).toBeUndefined();
    expect(resolveRetryPolicy('trigger.manual', { maxAttempts: 2 })).toBeUndefined();
  });

  it('overrides only the fields that were set', () => {
    expect(resolveRetryPolicy('mock.service', { maxAttempts: 5, initialIntervalMs: 2000 })).toEqual(
      { maxAttempts: 5, timeoutSeconds: 30, initialIntervalMs: 2000 },
    );
  });

  it('accepts a valid setting on a mock.service node', () => {
    const result = validateDefinition(
      withRetry({ maxAttempts: 5, timeoutSeconds: 60, initialIntervalMs: 2000 }),
    );
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('accepts an empty setting and a partial one', () => {
    expect(validateDefinition(withRetry({})).valid).toBe(true);
    expect(validateDefinition(withRetry({ maxAttempts: 2 })).valid).toBe(true);
  });

  it('accepts the limits themselves', () => {
    const low = { maxAttempts: 1, timeoutSeconds: 1, initialIntervalMs: 100 };
    const high = { maxAttempts: 10, timeoutSeconds: 120, initialIntervalMs: 30_000 };
    expect(validateDefinition(withRetry(low)).valid).toBe(true);
    expect(validateDefinition(withRetry(high)).valid).toBe(true);
  });

  it('rejects the setting on a node without effects', () => {
    const result = validateDefinition(withRetry({ maxAttempts: 2 }, 'logic.merge'));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: 'UNKNOWN_FIELD',
        location: { node: 'a', field: 'retry' },
      }),
    );
  });

  it.each([
    [
      { maxAttempts: 0 },
      'retry.maxAttempts',
      'El campo «Intentos máximos» debe ser como mínimo 1.',
    ],
    [
      { maxAttempts: 11 },
      'retry.maxAttempts',
      'El campo «Intentos máximos» debe ser como máximo 10.',
    ],
    [
      { timeoutSeconds: 0 },
      'retry.timeoutSeconds',
      'El campo «Tiempo máximo por intento (s)» debe ser como mínimo 1.',
    ],
    [
      { timeoutSeconds: 121 },
      'retry.timeoutSeconds',
      'El campo «Tiempo máximo por intento (s)» debe ser como máximo 120.',
    ],
    [
      { initialIntervalMs: 99 },
      'retry.initialIntervalMs',
      'El campo «Espera inicial (ms)» debe ser como mínimo 100.',
    ],
    [
      { initialIntervalMs: 30_001 },
      'retry.initialIntervalMs',
      'El campo «Espera inicial (ms)» debe ser como máximo 30000.',
    ],
    [
      { maxAttempts: 2.5 },
      'retry.maxAttempts',
      'El campo «Intentos máximos» debe ser un número entero.',
    ],
  ])('rejects %j with a message in Spanish on the field', (retry, field, message) => {
    const result = validateDefinition(withRetry(retry));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual({
      code: 'SCHEMA_INVALID',
      message,
      location: { node: 'a', field },
    });
  });

  it('rejects unknown fields in the setting', () => {
    const result = validateDefinition(withRetry({ maxAttempts: 2, backoff: 3 }));
    expect(result.errors.map((e) => e.code)).toContain('UNKNOWN_FIELD');
  });
});

describe('mock.service fault injection (FR-013, FR-014)', () => {
  const schema = NODE_CATALOG['mock.service'].configSchema;
  const base = { latencyMs: 0, failureRate: 0, failureKind: 'transient' };

  it('keeps accepting the F3 configuration', () => {
    expect(schema.safeParse(base).success).toBe(true);
  });

  it('accepts rate_limited with a wait', () => {
    const config = { ...base, failureKind: 'rate_limited', retryAfterMs: 3000 };
    expect(schema.safeParse(config).success).toBe(true);
  });

  it('bounds the wait to 0–60000 ms', () => {
    const config = { ...base, failureKind: 'rate_limited' };
    expect(schema.safeParse({ ...config, retryAfterMs: -1 }).success).toBe(false);
    expect(schema.safeParse({ ...config, retryAfterMs: 60_001 }).success).toBe(false);
    expect(schema.safeParse({ ...config, retryAfterMs: 60_000 }).success).toBe(true);
  });

  it('accepts a wait only with rate_limited', () => {
    const result = schema.safeParse({ ...base, retryAfterMs: 500 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      'La espera indicada solo se usa con el tipo de fallo «rate_limited».',
    );
    expect(schema.safeParse({ ...base, retryAfterMs: 0 }).success).toBe(true);
  });

  it('bounds failFirstAttempts to 0–10', () => {
    expect(schema.safeParse({ ...base, failFirstAttempts: 0 }).success).toBe(true);
    expect(schema.safeParse({ ...base, failFirstAttempts: 10 }).success).toBe(true);
    expect(schema.safeParse({ ...base, failFirstAttempts: 11 }).success).toBe(false);
    expect(schema.safeParse({ ...base, failFirstAttempts: -1 }).success).toBe(false);
    expect(schema.safeParse({ ...base, failFirstAttempts: 1.5 }).success).toBe(false);
  });

  it('still rejects an unknown failure kind', () => {
    expect(schema.safeParse({ ...base, failureKind: 'flaky' }).success).toBe(false);
  });
});
