import { describe, expect, it } from 'vitest';
import { evaluateCondition, RuntimeEvaluationError, type Condition } from '../../src/index.js';

const outputs = {
  trigger: {
    amount: 150,
    message: 'hola',
    tone: 'happy',
    ok: true,
    when: '2026-05-01T10:00:00Z',
    nested: { score: 7 },
  },
};

const ref = (field: string) => ({ kind: 'ref', path: `nodes.trigger.output.${field}` }) as const;
const num = (value: number) => ({ kind: 'literal', type: 'number', value }) as const;
const str = (value: string) => ({ kind: 'literal', type: 'string', value }) as const;
const bool = (value: boolean) => ({ kind: 'literal', type: 'boolean', value }) as const;
const date = (value: string) => ({ kind: 'literal', type: 'datetime', value }) as const;

const run = (condition: Condition) => evaluateCondition(condition, outputs);

function errorCode(condition: Condition): string | undefined {
  try {
    run(condition);
  } catch (error) {
    return error instanceof RuntimeEvaluationError ? error.code : 'OTHER';
  }
  return undefined;
}

describe('evaluateCondition', () => {
  it.each([
    ['eq', 150, true],
    ['eq', 100, false],
    ['neq', 100, true],
    ['gt', 100, true],
    ['gt', 150, false],
    ['gte', 150, true],
    ['lt', 200, true],
    ['lt', 150, false],
    ['lte', 150, true],
  ] as const)('number %s against %s is %s', (op, right, expected) => {
    expect(run({ op, left: ref('amount'), right: num(right) })).toBe(expected);
  });

  it('compares strings and booleans for equality', () => {
    expect(run({ op: 'eq', left: ref('message'), right: str('hola') })).toBe(true);
    expect(run({ op: 'neq', left: ref('message'), right: str('hola') })).toBe(false);
    expect(run({ op: 'eq', left: ref('ok'), right: bool(true) })).toBe(true);
    expect(run({ op: 'eq', left: ref('tone'), right: str('happy') })).toBe(true);
  });

  it('reads nested fields', () => {
    expect(run({ op: 'gt', left: ref('nested.score'), right: num(5) })).toBe(true);
  });

  it('compares datetimes as instants, not as text', () => {
    expect(run({ op: 'eq', left: ref('when'), right: date('2026-05-01T12:00:00+02:00') })).toBe(
      true,
    );
    expect(run({ op: 'lt', left: ref('when'), right: date('2026-06-01T00:00:00Z') })).toBe(true);
    expect(run({ op: 'gt', left: ref('when'), right: date('2026-06-01T00:00:00Z') })).toBe(false);
  });

  it('evaluates in against literal options', () => {
    expect(run({ op: 'in', value: ref('tone'), options: [str('sad'), str('happy')] })).toBe(true);
    expect(run({ op: 'in', value: ref('tone'), options: [str('sad')] })).toBe(false);
    expect(run({ op: 'in', value: ref('amount'), options: [num(1), num(150)] })).toBe(true);
  });

  it('evaluates exists for present and absent fields', () => {
    expect(run({ op: 'exists', operand: ref('amount') })).toBe(true);
    expect(run({ op: 'exists', operand: ref('missing') })).toBe(false);
    expect(run({ op: 'exists', operand: { kind: 'ref', path: 'nodes.other.output.amount' } })).toBe(
      false,
    );
  });

  it('combines with and, or and not', () => {
    const big: Condition = { op: 'gt', left: ref('amount'), right: num(100) };
    const small: Condition = { op: 'lt', left: ref('amount'), right: num(100) };
    expect(run({ op: 'and', operands: [big, big] })).toBe(true);
    expect(run({ op: 'and', operands: [big, small] })).toBe(false);
    expect(run({ op: 'or', operands: [small, big] })).toBe(true);
    expect(run({ op: 'or', operands: [small, small] })).toBe(false);
    expect(run({ op: 'not', operand: small })).toBe(true);
  });

  it('fails with a type mismatch instead of coercing', () => {
    expect(errorCode({ op: 'eq', left: ref('amount'), right: str('150') })).toBe(
      'CONDITION_TYPE_MISMATCH',
    );
    expect(errorCode({ op: 'gt', left: ref('message'), right: num(1) })).toBe(
      'CONDITION_TYPE_MISMATCH',
    );
    expect(errorCode({ op: 'gt', left: ref('message'), right: str('a') })).toBe(
      'CONDITION_TYPE_MISMATCH',
    );
  });

  it('fails when a referenced value is missing', () => {
    expect(errorCode({ op: 'eq', left: ref('missing'), right: num(1) })).toBe(
      'REFERENCE_VALUE_MISSING',
    );
    expect(
      errorCode({
        op: 'eq',
        left: { kind: 'ref', path: 'nodes.skipped_node.output.ok' },
        right: bool(true),
      }),
    ).toBe('REFERENCE_VALUE_MISSING');
  });

  it('never evaluates code: references are plain lookups', () => {
    const evil = { kind: 'ref', path: 'constructor.constructor("return 1")()' } as const;
    expect(errorCode({ op: 'eq', left: evil, right: num(1) })).toBe('REFERENCE_MALFORMED');
    const proto = { kind: 'ref', path: 'nodes.trigger.output.__proto__' } as const;
    expect(errorCode({ op: 'exists', operand: proto })).toBe('REFERENCE_MALFORMED');
    const inherited = { kind: 'ref', path: 'nodes.trigger.output.constructor' } as const;
    expect(evaluateCondition({ op: 'exists', operand: inherited }, { trigger: {} })).toBe(false);
    expect(
      evaluateCondition(
        { op: 'eq', left: inherited, right: num(5) },
        { trigger: { constructor: 5 } },
      ),
    ).toBe(true);
  });

  it('rejects an empty operand path', () => {
    expect(errorCode({ op: 'exists', operand: { kind: 'ref', path: '' } })).toBe(
      'REFERENCE_MALFORMED',
    );
  });
});
