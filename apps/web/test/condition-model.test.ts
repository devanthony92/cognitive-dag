import { describe, expect, it } from 'vitest';
import {
  CONDITION_MAX_DEPTH,
  CONDITION_MAX_OPERATIONS,
  ConditionSchema,
  measureCondition,
  type Condition,
} from '@cognitive-dag/dag-schema';
import {
  addChild,
  changeOp,
  defaultCondition,
  fits,
  getAt,
  removeAt,
  replaceAt,
} from '../src/features/workflows/condition-model';

const parses = (c: Condition) => ConditionSchema.safeParse(c).success;
const REF = 'nodes.a.output.x';

describe('defaultCondition', () => {
  it.each(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'exists', 'and', 'or', 'not'] as const)(
    'builds a valid shape for %s',
    (op) => {
      const condition = defaultCondition(op, REF);
      expect(condition.op).toBe(op);
      expect(parses(condition)).toBe(true);
    },
  );
});

describe('changeOp', () => {
  const comparison: Condition = {
    op: 'gt',
    left: { kind: 'ref', path: 'nodes.a.output.n' },
    right: { kind: 'literal', type: 'number', value: 3 },
  };

  it('keeps the operands when switching between comparisons', () => {
    expect(changeOp(comparison, 'lte')).toEqual({ ...comparison, op: 'lte' });
  });

  it('wraps the current condition when it becomes a group or a negation', () => {
    expect(changeOp(comparison, 'and')).toEqual({ op: 'and', operands: [comparison] });
    expect(changeOp(comparison, 'not')).toEqual({ op: 'not', operand: comparison });
  });

  it('unwraps the first child when a group becomes a comparison', () => {
    expect(changeOp({ op: 'or', operands: [comparison] }, 'eq')).toEqual({
      ...comparison,
      op: 'eq',
    });
  });

  it('switches a group between and / or without losing the children', () => {
    const group: Condition = { op: 'and', operands: [comparison, comparison] };
    expect(changeOp(group, 'or')).toEqual({ op: 'or', operands: [comparison, comparison] });
  });

  it('always produces a valid tree', () => {
    for (const from of ['eq', 'in', 'exists', 'and', 'not'] as const) {
      for (const to of ['eq', 'gt', 'in', 'exists', 'and', 'or', 'not'] as const) {
        expect(parses(changeOp(defaultCondition(from, REF), to))).toBe(true);
      }
    }
  });
});

describe('path editing', () => {
  const leaf = defaultCondition('eq', REF);
  const root: Condition = { op: 'and', operands: [leaf, { op: 'not', operand: leaf }] };

  it('reads and replaces nodes by path of child indexes', () => {
    expect(getAt(root, [])).toBe(root);
    expect(getAt(root, [0])).toBe(leaf);
    expect(getAt(root, [1, 0])).toBe(leaf);
    const next = replaceAt(root, [1, 0], defaultCondition('exists', REF));
    expect(getAt(next, [1, 0])?.op).toBe('exists');
    expect(getAt(root, [1, 0])).toBe(leaf);
  });

  it('adds a child to a group and removes it, never leaving an empty group', () => {
    const grown = addChild(root, [], leaf);
    expect((grown as { operands: unknown[] }).operands).toHaveLength(3);
    const shrunk = removeAt(grown, [2]);
    expect((shrunk as { operands: unknown[] }).operands).toHaveLength(2);
    const single: Condition = { op: 'and', operands: [leaf] };
    expect(removeAt(single, [0])).toBe(single);
  });
});

describe('limits of the builder', () => {
  it('stops growing a group at 20 operations, still valid', () => {
    let condition: Condition = { op: 'and', operands: [defaultCondition('eq', REF)] };
    for (;;) {
      const grown = addChild(condition, [], defaultCondition('eq', REF));
      if (!fits(grown)) break;
      condition = grown;
    }
    expect(measureCondition(condition).operations).toBe(CONDITION_MAX_OPERATIONS);
    expect(parses(condition)).toBe(true);
  });

  it('stops nesting at depth 5, still valid', () => {
    let condition: Condition = defaultCondition('not', REF);
    let path: number[] = [0];
    for (;;) {
      const nested = replaceAt(condition, path, defaultCondition('not', REF));
      if (!fits(nested)) break;
      condition = nested;
      path = [...path, 0];
    }
    expect(measureCondition(condition).depth).toBe(CONDITION_MAX_DEPTH);
    expect(parses(condition)).toBe(true);
  });
});
