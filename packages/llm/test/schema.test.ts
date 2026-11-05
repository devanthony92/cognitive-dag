import type { DagType } from '@cognitive-dag/dag-schema';
import { describe, expect, it } from 'vitest';
import { toJsonSchema, toZodSchema } from '../src/index.js';

const classifyType: DagType = {
  kind: 'object',
  fields: {
    label: { kind: 'enum', values: ['spam', 'ham'] },
    confidence: { kind: 'number', min: 0, max: 1 },
  },
};

const extractType: DagType = {
  kind: 'object',
  fields: {
    name: { kind: 'string' },
    age: { kind: 'number' },
    vip: { kind: 'boolean' },
    seen: { kind: 'datetime' },
    tags: { kind: 'list', item: { kind: 'string' } },
    address: { kind: 'object', fields: { city: { kind: 'string' } } },
  },
};

describe('toJsonSchema (structured output)', () => {
  it('closes the enum of a classification and bounds the confidence', () => {
    expect(toJsonSchema(classifyType)).toEqual({
      type: 'object',
      properties: {
        label: { type: 'string', enum: ['spam', 'ham'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['label', 'confidence'],
      additionalProperties: false,
    });
  });

  it('maps every kind and requires every field', () => {
    expect(toJsonSchema(extractType)).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
        vip: { type: 'boolean' },
        seen: { type: 'string', format: 'date-time' },
        tags: { type: 'array', items: { type: 'string' } },
        address: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
          additionalProperties: false,
        },
      },
      required: ['name', 'age', 'vip', 'seen', 'tags', 'address'],
      additionalProperties: false,
    });
  });

  it('never admits null: no field of a DagType is nullable', () => {
    expect(JSON.stringify(toJsonSchema(extractType))).not.toContain('null');
  });

  it('closes every nested object', () => {
    const nested: DagType = {
      kind: 'list',
      item: { kind: 'object', fields: { a: { kind: 'string' } } },
    };
    expect(toJsonSchema(nested)).toEqual({
      type: 'array',
      items: {
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a'],
        additionalProperties: false,
      },
    });
  });
});

describe('toZodSchema', () => {
  const classify = toZodSchema(classifyType);

  it('accepts a valid classification', () => {
    expect(classify.safeParse({ label: 'spam', confidence: 0.9 }).success).toBe(true);
  });

  it.each([
    ['a label outside the enum', { label: 'other', confidence: 0.5 }],
    ['a confidence above 1', { label: 'spam', confidence: 1.2 }],
    ['a confidence below 0', { label: 'spam', confidence: -0.1 }],
    ['an extra field', { label: 'spam', confidence: 0.5, note: 'x' }],
    ['a missing field', { label: 'spam' }],
    ['a null field', { label: null, confidence: 0.5 }],
    ['a string for a number', { label: 'spam', confidence: '0.5' }],
  ])('rejects %s', (_name, value) => {
    expect(classify.safeParse(value).success).toBe(false);
  });

  it('validates every kind of an extraction', () => {
    const extract = toZodSchema(extractType);
    const valid = {
      name: 'Ana',
      age: 31,
      vip: false,
      seen: '2026-11-05T10:00:00Z',
      tags: ['a'],
      address: { city: 'Cali' },
    };
    expect(extract.safeParse(valid).success).toBe(true);
    expect(extract.safeParse({ ...valid, seen: 'ayer' }).success).toBe(false);
    expect(extract.safeParse({ ...valid, tags: [1] }).success).toBe(false);
    expect(extract.safeParse({ ...valid, address: { city: 'x', extra: 1 } }).success).toBe(false);
  });
});
