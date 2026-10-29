import { describe, expect, it } from 'vitest';
import {
  CreatePingRequestSchema,
  CorrelationIdSchema,
  PingIdSchema,
  ProblemDetailsSchema,
  resolveCorrelationId,
} from '../src/index.js';

const VALID_UUID = '3f2b0c1e-5d6a-4b7c-8d9e-0f1a2b3c4d5e';

describe('ProblemDetailsSchema', () => {
  const base = {
    status: 404,
    title: 'Not Found',
    detail: 'El recurso no existe.',
    code: 'PING_NOT_FOUND',
    correlationId: VALID_UUID,
  };

  it('accepts the required fields', () => {
    expect(ProblemDetailsSchema.safeParse(base).success).toBe(true);
  });

  it.each(['status', 'title', 'detail', 'code', 'correlationId'])('requires %s', (field) => {
    const { [field as keyof typeof base]: _omitted, ...rest } = base;
    expect(ProblemDetailsSchema.safeParse(rest).success).toBe(false);
  });

  it.each(['type', 'instance'])('rejects %s', (field) => {
    expect(ProblemDetailsSchema.safeParse({ ...base, [field]: 'x' }).success).toBe(false);
  });

  it('rejects unknown codes', () => {
    expect(ProblemDetailsSchema.safeParse({ ...base, code: 'SOMETHING_ELSE' }).success).toBe(false);
  });

  it('accepts errors[] with field and message', () => {
    const problem = {
      ...base,
      status: 422,
      code: 'VALIDATION_FAILED',
      errors: [{ field: 'message', message: 'Debe tener entre 1 y 100 caracteres.' }],
    };
    expect(ProblemDetailsSchema.safeParse(problem).success).toBe(true);
  });
});

describe('CreatePingRequestSchema', () => {
  it('accepts an empty body', () => {
    expect(CreatePingRequestSchema.safeParse({}).success).toBe(true);
  });

  it.each([
    ['empty message', ''],
    ['101 characters', 'a'.repeat(101)],
    ['control characters', 'hola\u0000mundo'],
  ])('rejects %s', (_case, message) => {
    expect(CreatePingRequestSchema.safeParse({ message }).success).toBe(false);
  });

  it('accepts 1 to 100 printable characters', () => {
    expect(CreatePingRequestSchema.safeParse({ message: 'a' }).success).toBe(true);
    expect(CreatePingRequestSchema.safeParse({ message: 'ñ'.repeat(100) }).success).toBe(true);
  });

  it('rejects unknown properties', () => {
    expect(CreatePingRequestSchema.safeParse({ message: 'hola', extra: 1 }).success).toBe(false);
  });
});

describe('PingIdSchema', () => {
  it('accepts ping-<uuid>', () => {
    expect(PingIdSchema.safeParse(`ping-${VALID_UUID}`).success).toBe(true);
  });

  it('rejects other formats', () => {
    expect(PingIdSchema.safeParse(VALID_UUID).success).toBe(false);
    expect(PingIdSchema.safeParse('ping-../../etc').success).toBe(false);
  });
});

describe('correlation id', () => {
  it('accepts a valid UUID of at most 36 characters', () => {
    expect(CorrelationIdSchema.safeParse(VALID_UUID).success).toBe(true);
  });

  it('keeps a valid incoming id', () => {
    expect(resolveCorrelationId(VALID_UUID)).toBe(VALID_UUID);
  });

  it.each([
    ['missing', undefined],
    ['not a uuid', 'not-a-uuid'],
    ['too long', `${VALID_UUID}-extra`],
    ['control characters', `${VALID_UUID.slice(0, 35)}\n`],
    ['array header', [VALID_UUID, VALID_UUID]],
  ])('replaces a %s id with a new UUID', (_case, input) => {
    const resolved = resolveCorrelationId(input);
    expect(resolved).not.toBe(input);
    expect(CorrelationIdSchema.safeParse(resolved).success).toBe(true);
  });
});
