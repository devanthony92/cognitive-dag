import { describe, expect, it } from 'vitest';
import {
  CONDITION_MAX_DEPTH,
  CONDITION_MAX_OPERATIONS,
  ConditionSchema,
  checkCondition,
  measureCondition,
  type Condition,
  type DagType,
  type ReferenceScope,
} from '../src/index.js';

const ref = (field: string) => ({ kind: 'ref', path: `nodes.trigger.output.${field}` });
const num = (value: number) => ({ kind: 'literal', type: 'number', value });
const str = (value: string) => ({ kind: 'literal', type: 'string', value });

const scope: ReferenceScope = {
  outputs: new Map<string, DagType | null>([
    [
      'trigger',
      {
        kind: 'object',
        fields: {
          amount: { kind: 'number' },
          message: { kind: 'string' },
          tone: { kind: 'enum', values: ['happy', 'sad'] },
          when: { kind: 'datetime' },
          ok: { kind: 'boolean' },
        },
      },
    ],
  ]),
  ancestors: new Set(['trigger']),
};

function parse(value: unknown): Condition {
  return ConditionSchema.parse(value);
}

function nest(levels: number): unknown {
  let c: unknown = { op: 'eq', left: ref('amount'), right: num(1) };
  for (let i = 1; i < levels; i++) c = { op: 'not', operand: c };
  return c;
}

describe('ConditionSchema (research R6)', () => {
  it.each([
    { op: 'eq', left: ref('amount'), right: num(1) },
    { op: 'neq', left: ref('message'), right: str('x') },
    { op: 'gt', left: ref('amount'), right: num(1) },
    { op: 'gte', left: ref('amount'), right: num(1) },
    { op: 'lt', left: ref('amount'), right: num(1) },
    { op: 'lte', left: ref('amount'), right: num(1) },
    { op: 'in', value: ref('tone'), options: [str('happy'), str('sad')] },
    { op: 'exists', operand: ref('message') },
    {
      op: 'and',
      operands: [
        { op: 'exists', operand: ref('message') },
        { op: 'exists', operand: ref('amount') },
      ],
    },
    {
      op: 'or',
      operands: [
        { op: 'exists', operand: ref('message') },
        { op: 'exists', operand: ref('amount') },
      ],
    },
    { op: 'not', operand: { op: 'exists', operand: ref('message') } },
  ])('accepts $op', (value) => {
    expect(ConditionSchema.safeParse(value).success).toBe(true);
  });

  it('rejects unknown operations, unknown fields and bad operands', () => {
    expect(
      ConditionSchema.safeParse({ op: 'regex', left: ref('message'), right: str('.*') }).success,
    ).toBe(false);
    expect(
      ConditionSchema.safeParse({ op: 'eq', left: ref('amount'), right: num(1), extra: 1 }).success,
    ).toBe(false);
    expect(ConditionSchema.safeParse({ op: 'eq', left: ref('amount') }).success).toBe(false);
    expect(
      ConditionSchema.safeParse({ op: 'eq', left: { kind: 'expr', code: '1+1' }, right: num(1) })
        .success,
    ).toBe(false);
    expect(ConditionSchema.safeParse({ op: 'and', operands: [] }).success).toBe(false);
    expect(ConditionSchema.safeParse({ op: 'in', value: ref('tone'), options: [] }).success).toBe(
      false,
    );
    expect(ConditionSchema.safeParse('1 === 1').success).toBe(false);
    expect(ConditionSchema.safeParse(null).success).toBe(false);
  });

  it('checks that literal values match their declared type', () => {
    const lit = (type: string, value: unknown) => ({
      op: 'eq',
      left: ref('amount'),
      right: { kind: 'literal', type, value },
    });
    expect(ConditionSchema.safeParse(lit('number', 'x')).success).toBe(false);
    expect(ConditionSchema.safeParse(lit('number', Number.NaN)).success).toBe(false);
    expect(ConditionSchema.safeParse(lit('boolean', 1)).success).toBe(false);
    expect(ConditionSchema.safeParse(lit('string', 1)).success).toBe(false);
    expect(ConditionSchema.safeParse(lit('datetime', 'yesterday')).success).toBe(false);
    expect(ConditionSchema.safeParse(lit('datetime', '2026-10-30T12:00:00Z')).success).toBe(true);
    expect(ConditionSchema.safeParse(lit('boolean', true)).success).toBe(true);
  });

  it('accepts depth 5 and rejects depth 6', () => {
    expect(CONDITION_MAX_DEPTH).toBe(5);
    expect(measureCondition(nest(5)).depth).toBe(5);
    expect(ConditionSchema.safeParse(nest(5)).success).toBe(true);
    expect(measureCondition(nest(6)).depth).toBe(6);
    expect(ConditionSchema.safeParse(nest(6)).success).toBe(false);
  });

  it('survives absurdly deep input without overflowing the stack', () => {
    expect(ConditionSchema.safeParse(nest(100_000)).success).toBe(false);
  });

  it('accepts 20 operations and rejects 21', () => {
    expect(CONDITION_MAX_OPERATIONS).toBe(20);
    const leaf = { op: 'exists', operand: ref('message') };
    const withLeaves = (n: number) => ({
      op: 'and',
      operands: Array.from({ length: n }, () => leaf),
    });
    expect(measureCondition(withLeaves(19)).operations).toBe(20);
    expect(ConditionSchema.safeParse(withLeaves(19)).success).toBe(true);
    expect(ConditionSchema.safeParse(withLeaves(20)).success).toBe(false);
  });
});

describe('measureCondition', () => {
  it('counts a leaf as depth 1 and 1 operation', () => {
    expect(measureCondition({ op: 'exists', operand: ref('a') })).toEqual({
      depth: 1,
      operations: 1,
    });
  });

  it('tolerates garbage input', () => {
    expect(measureCondition(42)).toEqual({ depth: 0, operations: 0 });
    expect(measureCondition(null)).toEqual({ depth: 0, operations: 0 });
  });
});

describe('checkCondition operand types', () => {
  const codes = (c: unknown) => checkCondition(parse(c), scope).map((i) => i.code);

  it('accepts well-typed conditions', () => {
    expect(codes({ op: 'gt', left: ref('amount'), right: num(10) })).toEqual([]);
    expect(codes({ op: 'eq', left: ref('tone'), right: str('happy') })).toEqual([]);
    expect(codes({ op: 'eq', left: ref('message'), right: ref('tone') })).toEqual([]);
    expect(codes({ op: 'in', value: ref('tone'), options: [str('happy')] })).toEqual([]);
    expect(codes({ op: 'exists', operand: ref('when') })).toEqual([]);
    expect(
      codes({
        op: 'gt',
        left: ref('when'),
        right: { kind: 'literal', type: 'datetime', value: '2026-01-01T00:00:00Z' },
      }),
    ).toEqual([]);
  });

  it('rejects ordering on non-ordered types', () => {
    expect(codes({ op: 'gt', left: ref('message'), right: str('a') })).toEqual([
      'CONDITION_TYPE_MISMATCH',
    ]);
    expect(
      codes({
        op: 'lt',
        left: ref('ok'),
        right: { kind: 'literal', type: 'boolean', value: true },
      }),
    ).toEqual(['CONDITION_TYPE_MISMATCH']);
  });

  it('rejects comparing incompatible types', () => {
    expect(codes({ op: 'eq', left: ref('amount'), right: str('x') })).toEqual([
      'CONDITION_TYPE_MISMATCH',
    ]);
    expect(codes({ op: 'neq', left: ref('when'), right: num(1) })).toEqual([
      'CONDITION_TYPE_MISMATCH',
    ]);
    expect(codes({ op: 'in', value: ref('amount'), options: [str('x')] })).toEqual([
      'CONDITION_TYPE_MISMATCH',
    ]);
  });

  it('reports reference errors from operands, with the failing code', () => {
    expect(
      codes({ op: 'eq', left: { kind: 'ref', path: 'nodes.ghost.output.x' }, right: num(1) }),
    ).toEqual(['REFERENCE_NODE_NOT_FOUND']);
    expect(codes({ op: 'exists', operand: ref('nope') })).toEqual(['REFERENCE_FIELD_NOT_FOUND']);
  });

  it('descends through and, or and not', () => {
    const bad = { op: 'gt', left: ref('message'), right: str('a') };
    expect(
      codes({ op: 'not', operand: { op: 'and', operands: [bad, { op: 'or', operands: [bad] }] } }),
    ).toEqual(['CONDITION_TYPE_MISMATCH', 'CONDITION_TYPE_MISMATCH']);
  });

  it('rejects comparing two literals against nothing useful only when types differ', () => {
    expect(codes({ op: 'eq', left: num(1), right: num(1) })).toEqual([]);
    expect(codes({ op: 'eq', left: num(1), right: str('1') })).toEqual(['CONDITION_TYPE_MISMATCH']);
  });
});

describe('empty operands (review fix)', () => {
  const messages = (value: unknown) => checkCondition(parse(value), scope).map((i) => i.message);

  it('asks for the field when a reference has no field chosen, naming the side', () => {
    expect(messages({ op: 'eq', left: { kind: 'ref', path: '' }, right: num(1) })).toEqual([
      'Elige el campo de la izquierda.',
    ]);
    expect(messages({ op: 'eq', left: num(1), right: { kind: 'ref', path: '' } })).toEqual([
      'Elige el campo de la derecha.',
    ]);
  });

  it('asks for a value when a text literal is left empty, naming the side', () => {
    expect(messages({ op: 'eq', left: ref('tone'), right: str('') })).toEqual([
      'Elige un valor para la derecha.',
    ]);
    expect(messages({ op: 'neq', left: str(''), right: ref('tone') })).toEqual([
      'Elige un valor para la izquierda.',
    ]);
  });

  it('covers exists, in and its options', () => {
    expect(messages({ op: 'exists', operand: { kind: 'ref', path: '' } })).toEqual([
      'Elige el campo que debe existir.',
    ]);
    expect(messages({ op: 'in', value: { kind: 'ref', path: '' }, options: [str('a')] })).toEqual([
      'Elige el campo que se comparará.',
    ]);
    expect(messages({ op: 'in', value: ref('tone'), options: [str('happy'), str('')] })).toEqual([
      'Elige un valor para la opción 2.',
    ]);
  });

  it('does not add a type mismatch on top of the empty operand', () => {
    expect(messages({ op: 'gt', left: { kind: 'ref', path: '' }, right: str('') })).toHaveLength(2);
  });

  it('still accepts a filled condition', () => {
    expect(messages({ op: 'eq', left: ref('tone'), right: str('happy') })).toEqual([]);
  });
});
