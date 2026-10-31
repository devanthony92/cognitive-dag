import type { Condition, Operand } from '../conditions.js';
import { RuntimeEvaluationError, resolveReferenceValue, type NodeOutputs } from './values.js';

type Scalar =
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean };

type Evaluated = Scalar | { type: 'datetime'; value: string };

function mismatch(op: string, a: Evaluated, b: Evaluated): RuntimeEvaluationError {
  return new RuntimeEvaluationError(
    'CONDITION_TYPE_MISMATCH',
    `La comparación «${op}» no se puede aplicar entre ${a.type} y ${b.type}.`,
  );
}

function readOperand(operand: Operand, outputs: NodeOutputs): Evaluated {
  if (operand.kind === 'literal') return operand;
  const resolved = resolveReferenceValue(operand.path, outputs);
  if (!resolved.ok) throw new RuntimeEvaluationError(resolved.code, resolved.message);
  const { value } = resolved;
  if (typeof value === 'string') return { type: 'string', value };
  if (typeof value === 'number') return { type: 'number', value };
  if (typeof value === 'boolean') return { type: 'boolean', value };
  throw new RuntimeEvaluationError(
    'CONDITION_TYPE_MISMATCH',
    `La referencia «${operand.path}» no es un valor simple.`,
  );
}

function instant(op: string, a: Evaluated, b: Evaluated, side: Evaluated): number {
  const time = typeof side.value === 'string' ? Date.parse(side.value) : Number.NaN;
  if (Number.isNaN(time)) throw mismatch(op, a, b);
  return time;
}

/** Datetimes travel as ISO text, so a text next to a datetime (or ordered by `<`) is read as one. */
function comparable(
  op: string,
  a: Evaluated,
  b: Evaluated,
  ordering: boolean,
): [number | string | boolean, number | string | boolean] {
  if (a.type === 'datetime' || b.type === 'datetime') {
    if (a.type === 'number' || a.type === 'boolean' || b.type === 'number' || b.type === 'boolean')
      throw mismatch(op, a, b);
    return [instant(op, a, b, a), instant(op, a, b, b)];
  }
  if (a.type !== b.type) throw mismatch(op, a, b);
  if (ordering) {
    if (a.type === 'number' && b.type === 'number') return [a.value, b.value];
    // Two texts only order as datetimes; anything else is not an ordering the editor allows.
    return [instant(op, a, b, a), instant(op, a, b, b)];
  }
  return [a.value, b.value];
}

function compare(
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte',
  left: Evaluated,
  right: Evaluated,
): boolean {
  const ordering = op !== 'eq' && op !== 'neq';
  const [a, b] = comparable(op, left, right, ordering);
  switch (op) {
    case 'eq':
      return a === b;
    case 'neq':
      return a !== b;
    case 'gt':
      return a > b;
    case 'gte':
      return a >= b;
    case 'lt':
      return a < b;
    case 'lte':
      return a <= b;
  }
}

/**
 * Evaluates a condition over the outputs of the nodes that already ran (FR-009). The tree is data:
 * only the closed set of operations is interpreted, and nothing is ever evaluated as code. A type
 * mismatch or a missing value fails; only `exists` tolerates a missing value.
 */
export function evaluateCondition(condition: Condition, outputs: NodeOutputs): boolean {
  switch (condition.op) {
    case 'and':
      return condition.operands.every((operand) => evaluateCondition(operand, outputs));
    case 'or':
      return condition.operands.some((operand) => evaluateCondition(operand, outputs));
    case 'not':
      return !evaluateCondition(condition.operand, outputs);
    case 'exists': {
      const resolved = resolveReferenceValue(condition.operand.path, outputs);
      if (resolved.ok) return true;
      if (resolved.code === 'REFERENCE_VALUE_MISSING') return false;
      throw new RuntimeEvaluationError(resolved.code, resolved.message);
    }
    case 'in': {
      const value = readOperand(condition.value, outputs);
      return condition.options.some((option) => compare('eq', value, option));
    }
    default:
      return compare(
        condition.op,
        readOperand(condition.left, outputs),
        readOperand(condition.right, outputs),
      );
  }
}
