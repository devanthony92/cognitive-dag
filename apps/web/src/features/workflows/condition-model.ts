import {
  CONDITION_MAX_DEPTH,
  CONDITION_MAX_OPERATIONS,
  isAssignable,
  measureCondition,
  resolveReference,
  type Condition,
  type DagType,
  type LiteralOperand,
  type Operand,
  type ReferenceScope,
} from '@cognitive-dag/dag-schema';

export const COMPARISON_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const;
export type ComparisonOp = (typeof COMPARISON_OPS)[number];
export type OpChoice = ComparisonOp | 'in' | 'exists' | 'and' | 'or' | 'not';

export const OP_LABELS: Record<OpChoice, string> = {
  eq: 'es igual a',
  neq: 'es distinto de',
  gt: 'es mayor que',
  gte: 'es mayor o igual que',
  lt: 'es menor que',
  lte: 'es menor o igual que',
  in: 'está entre',
  exists: 'existe',
  and: 'Todas se cumplen (Y)',
  or: 'Alguna se cumple (O)',
  not: 'No se cumple (NO)',
};

type Comparison = Extract<Condition, { left: Operand }>;
type Group = { op: 'and' | 'or'; operands: Condition[] };

export const isComparison = (op: string): op is ComparisonOp =>
  (COMPARISON_OPS as readonly string[]).includes(op);

export const isOrdering = (op: string): boolean => isComparison(op) && op !== 'eq' && op !== 'neq';

const isGroup = (condition: Condition): condition is Group =>
  condition.op === 'and' || condition.op === 'or';

export const STRING_LITERAL: LiteralOperand = { kind: 'literal', type: 'string', value: '' };

/** A fresh condition of the given kind. `ref` seeds the operand that points to a field. */
export function defaultCondition(op: OpChoice, ref = ''): Condition {
  switch (op) {
    case 'in':
      return { op, value: { kind: 'ref', path: ref }, options: [{ ...STRING_LITERAL }] };
    case 'exists':
      return { op, operand: { kind: 'ref', path: ref } };
    case 'and':
    case 'or':
      return { op, operands: [defaultCondition('eq', ref)] };
    case 'not':
      return { op, operand: defaultCondition('eq', ref) };
    default:
      return { op, left: { kind: 'ref', path: ref }, right: { ...STRING_LITERAL } };
  }
}

function firstRef(condition: Condition): string {
  switch (condition.op) {
    case 'in':
      return condition.value.kind === 'ref' ? condition.value.path : '';
    case 'exists':
      return condition.operand.path;
    case 'and':
    case 'or':
      return condition.operands[0] ? firstRef(condition.operands[0]) : '';
    case 'not':
      return firstRef(condition.operand);
    default:
      return condition.left.kind === 'ref' ? condition.left.path : '';
  }
}

/**
 * Switches the kind of a node of the tree, keeping what can be kept: comparisons keep their
 * operands, groups keep their children, anything else is wrapped or unwrapped so the result is
 * always a valid tree.
 */
export function changeOp(condition: Condition, op: OpChoice): Condition {
  if (condition.op === op) return condition;
  if (isComparison(condition.op) && isComparison(op)) {
    return { ...(condition as Comparison), op };
  }
  if (isGroup(condition) && (op === 'and' || op === 'or'))
    return { op, operands: condition.operands };
  if (op === 'and' || op === 'or') return { op, operands: [condition] };
  if (op === 'not') return { op, operand: condition };

  // Becoming a leaf: a group or negation hands over its first child when that is a leaf.
  if (condition.op === 'not' || isGroup(condition)) {
    const child = condition.op === 'not' ? condition.operand : condition.operands[0];
    if (child && !isGroup(child) && child.op !== 'not') return changeOp(child, op);
  }
  return defaultCondition(op, firstRef(condition));
}

function childrenOf(condition: Condition): Condition[] {
  if (condition.op === 'not') return [condition.operand];
  return isGroup(condition) ? condition.operands : [];
}

export function getAt(root: Condition, path: readonly number[]): Condition | undefined {
  let current: Condition | undefined = root;
  for (const index of path) current = current ? childrenOf(current)[index] : undefined;
  return current;
}

/** Returns a copy of the tree where the node at `path` is `next`. */
export function replaceAt(root: Condition, path: readonly number[], next: Condition): Condition {
  const [head, ...rest] = path;
  if (head === undefined) return next;
  if (root.op === 'not') return { op: 'not', operand: replaceAt(root.operand, rest, next) };
  if (isGroup(root)) {
    return {
      op: root.op,
      operands: root.operands.map((child, i) =>
        i === head ? replaceAt(child, rest, next) : child,
      ),
    };
  }
  return root;
}

/** Appends `child` to the group at `path`. */
export function addChild(root: Condition, path: readonly number[], child: Condition): Condition {
  const target = getAt(root, path);
  if (!target || !isGroup(target)) return root;
  return replaceAt(root, path, { op: target.op, operands: [...target.operands, child] });
}

/** Removes the child at `path`. A group always keeps at least one child. */
export function removeAt(root: Condition, path: readonly number[]): Condition {
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1];
  const parent = getAt(root, parentPath);
  if (index === undefined || !parent || !isGroup(parent) || parent.operands.length <= 1) {
    return root;
  }
  return replaceAt(root, parentPath, {
    op: parent.op,
    operands: parent.operands.filter((_, i) => i !== index),
  });
}

/** True while the tree respects the depth and operation limits of the schema. */
export function fits(condition: Condition): boolean {
  const { depth, operations } = measureCondition(condition);
  return depth <= CONDITION_MAX_DEPTH && operations <= CONDITION_MAX_OPERATIONS;
}

const SCALARS = new Set(['string', 'number', 'boolean', 'datetime', 'enum']);

/**
 * Which field types an operand may point to, given the operation and the type of the other
 * operand. Same rules as `checkCondition`, so the selector offers only what will validate.
 */
export function operandAccepts(op: OpChoice, other?: DagType): (type: DagType) => boolean {
  if (op === 'exists') return () => true;
  return (type) => {
    if (isOrdering(op)) {
      if (type.kind !== 'number' && type.kind !== 'datetime') return false;
      return other === undefined || other.kind === type.kind;
    }
    if (!SCALARS.has(type.kind)) return false;
    if (other === undefined) return true;
    return SCALARS.has(other.kind) && (isAssignable(type, other) || isAssignable(other, type));
  };
}

/** The literal that matches a field type (an enum is compared as text); undefined if none does. */
export function literalFor(
  type: DagType | undefined,
  previous?: LiteralOperand,
): LiteralOperand | undefined {
  switch (type?.kind) {
    case 'string':
    case 'enum':
      return previous?.type === 'string' ? previous : { ...STRING_LITERAL };
    case 'number':
      return previous?.type === 'number' ? previous : { kind: 'literal', type: 'number', value: 0 };
    case 'boolean':
      return previous?.type === 'boolean'
        ? previous
        : { kind: 'literal', type: 'boolean', value: true };
    case 'datetime':
      return previous?.type === 'datetime'
        ? previous
        : { kind: 'literal', type: 'datetime', value: '2026-01-01T00:00:00Z' };
    default:
      return undefined;
  }
}

/** Type of an operand, or undefined while it points to nothing valid. */
export function operandType(operand: Operand, scope: ReferenceScope): DagType | undefined {
  if (operand.kind === 'literal') return { kind: operand.type };
  const resolved = resolveReference(operand.path, scope);
  return resolved.ok ? resolved.type : undefined;
}

/**
 * After one side of a comparison changed, makes the literal on the other side match its type, so
 * choosing a number field turns `"enojado"` into a number instead of leaving a mismatch behind.
 */
export function harmonize(condition: Condition, scope: ReferenceScope): Condition {
  if (isComparison(condition.op)) {
    const c = condition as Comparison;
    if (c.left.kind === 'ref' && c.right.kind === 'literal') {
      const next = literalFor(operandType(c.left, scope), c.right);
      return next && next !== c.right ? { ...c, right: next } : c;
    }
    if (c.right.kind === 'ref' && c.left.kind === 'literal') {
      const next = literalFor(operandType(c.right, scope), c.left);
      return next && next !== c.left ? { ...c, left: next } : c;
    }
    return c;
  }
  if (condition.op === 'in' && condition.value.kind === 'ref') {
    const type = operandType(condition.value, scope);
    return {
      ...condition,
      options: condition.options.map((option) => literalFor(type, option) ?? option),
    };
  }
  return condition;
}

const LEAF_OPS = new Set<string>([...COMPARISON_OPS, 'in', 'exists']);

/**
 * True when `value` has the shape the builder can draw (known operations, operands present).
 * It does not judge the content: a blank field is drawn, and the validator reports it.
 */
export function looksLikeCondition(value: unknown, depth = 0): value is Condition {
  if (depth > CONDITION_MAX_DEPTH + 1 || typeof value !== 'object' || value === null) return false;
  const c = value as Record<string, unknown>;
  const operand = (o: unknown) => typeof o === 'object' && o !== null && 'kind' in o;
  switch (c['op']) {
    case 'and':
    case 'or':
      return (
        Array.isArray(c['operands']) &&
        c['operands'].length > 0 &&
        c['operands'].every((child) => looksLikeCondition(child, depth + 1))
      );
    case 'not':
      return looksLikeCondition(c['operand'], depth + 1);
    case 'exists':
      return operand(c['operand']);
    case 'in':
      return operand(c['value']) && Array.isArray(c['options']) && c['options'].every(operand);
    default:
      return LEAF_OPS.has(String(c['op'])) && operand(c['left']) && operand(c['right']);
  }
}
