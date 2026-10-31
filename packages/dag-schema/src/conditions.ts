import { z } from 'zod';
import { resolveReference, type ReferenceScope } from './references.js';
import { describeType, isAssignable, type DagType } from './types.js';

export const CONDITION_MAX_DEPTH = 5;
export const CONDITION_MAX_OPERATIONS = 20;

export type ConditionErrorCode =
  | 'CONDITION_TOO_DEEP'
  | 'CONDITION_TOO_MANY_OPERATIONS'
  | 'CONDITION_TYPE_MISMATCH'
  | 'CONDITION_OPERAND_EMPTY';

export interface RefOperand {
  kind: 'ref';
  path: string;
}

export type LiteralOperand =
  | { kind: 'literal'; type: 'string'; value: string }
  | { kind: 'literal'; type: 'number'; value: number }
  | { kind: 'literal'; type: 'boolean'; value: boolean }
  | { kind: 'literal'; type: 'datetime'; value: string };

export type Operand = RefOperand | LiteralOperand;

/** Closed set of operations (research R6). The tree is data: nothing in it is ever evaluated as code. */
export type Condition =
  | { op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'; left: Operand; right: Operand }
  | { op: 'in'; value: Operand; options: LiteralOperand[] }
  | { op: 'exists'; operand: RefOperand }
  | { op: 'and' | 'or'; operands: Condition[] }
  | { op: 'not'; operand: Condition };

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

const RefOperandSchema = z.strictObject({
  kind: z.literal('ref'),
  // An empty path is a field the user has not chosen yet: `checkCondition` says which side.
  path: z.string().max(200),
});

const LiteralOperandSchema = z.union([
  z.strictObject({
    kind: z.literal('literal'),
    type: z.literal('string'),
    value: z.string().max(1000),
  }),
  z.strictObject({
    kind: z.literal('literal'),
    type: z.literal('number'),
    value: z.number().finite(),
  }),
  z.strictObject({ kind: z.literal('literal'), type: z.literal('boolean'), value: z.boolean() }),
  z.strictObject({
    kind: z.literal('literal'),
    type: z.literal('datetime'),
    value: z
      .string()
      .regex(ISO_DATETIME)
      .refine((v) => !Number.isNaN(Date.parse(v))),
  }),
]);

const OperandSchema = z.union([RefOperandSchema, LiteralOperandSchema]);

type DiscriminatedOptions = [z.ZodObject, ...z.ZodObject[]];

const leafSchemas = [
  ...(['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const).map((op) =>
    z.strictObject({ op: z.literal(op), left: OperandSchema, right: OperandSchema }),
  ),
  z.strictObject({
    op: z.literal('in'),
    value: OperandSchema,
    options: z.array(LiteralOperandSchema).min(1).max(CONDITION_MAX_OPERATIONS),
  }),
  z.strictObject({ op: z.literal('exists'), operand: RefOperandSchema }),
];

/** Built level by level so the parser never recurses deeper than the allowed depth. */
function conditionAt(level: number): z.ZodType<Condition> {
  if (level === 1)
    return z.discriminatedUnion(
      'op',
      leafSchemas as unknown as DiscriminatedOptions,
    ) as unknown as z.ZodType<Condition>;
  const inner = conditionAt(level - 1);
  return z.discriminatedUnion('op', [
    ...(leafSchemas as unknown as [z.ZodObject]),
    z.strictObject({
      op: z.literal('and'),
      operands: z.array(inner).min(1).max(CONDITION_MAX_OPERATIONS),
    }),
    z.strictObject({
      op: z.literal('or'),
      operands: z.array(inner).min(1).max(CONDITION_MAX_OPERATIONS),
    }),
    z.strictObject({ op: z.literal('not'), operand: inner }),
  ]) as unknown as z.ZodType<Condition>;
}

const StructureSchema = conditionAt(CONDITION_MAX_DEPTH);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function childrenOf(value: Record<string, unknown>): unknown[] {
  if (value['op'] === 'not') return [value['operand']];
  if ((value['op'] === 'and' || value['op'] === 'or') && Array.isArray(value['operands'])) {
    return value['operands'] as unknown[];
  }
  return [];
}

/**
 * Depth and operation count of untrusted input. Iterative (no recursion) and stops as soon as a
 * limit is passed, so hostile input cannot exhaust the stack or the CPU.
 */
export function measureCondition(value: unknown): { depth: number; operations: number } {
  let depth = 0;
  let operations = 0;
  const stack: Array<{ node: unknown; depth: number }> = [{ node: value, depth: 1 }];
  while (stack.length > 0) {
    const { node, depth: d } = stack.pop() as { node: unknown; depth: number };
    if (!isRecord(node)) continue;
    operations += 1;
    depth = Math.max(depth, d);
    if (depth > CONDITION_MAX_DEPTH || operations > CONDITION_MAX_OPERATIONS) break;
    for (const child of childrenOf(node)) stack.push({ node: child, depth: d + 1 });
  }
  return { depth, operations };
}

/** Parses a condition: limits first, then the strict structure. */
export const ConditionSchema: z.ZodType<Condition> = z
  .unknown()
  .superRefine((value, ctx) => {
    const { depth, operations } = measureCondition(value);
    if (depth > CONDITION_MAX_DEPTH) {
      ctx.addIssue({
        code: 'custom',
        message: `La condición supera la profundidad máxima de ${CONDITION_MAX_DEPTH} niveles.`,
        params: { dagCode: 'CONDITION_TOO_DEEP' satisfies ConditionErrorCode },
      });
    } else if (operations > CONDITION_MAX_OPERATIONS) {
      ctx.addIssue({
        code: 'custom',
        message: `La condición supera el máximo de ${CONDITION_MAX_OPERATIONS} operaciones.`,
        params: { dagCode: 'CONDITION_TOO_MANY_OPERATIONS' satisfies ConditionErrorCode },
      });
    }
  })
  .pipe(StructureSchema);

export interface ConditionIssue {
  code: string;
  message: string;
}

type Resolved = { ok: true; type: DagType } | { ok: false; issue: ConditionIssue };

/** True for an operand the user has not filled in: no field chosen, or an empty text. */
function isEmpty(operand: Operand): boolean {
  return operand.kind === 'ref'
    ? operand.path === ''
    : operand.type === 'string' && operand.value === '';
}

/** How an operand is named in a message, for a field and for a value: «de la izquierda». */
interface Side {
  field: string;
  value: string;
}

const LEFT: Side = { field: 'de la izquierda', value: 'la izquierda' };
const RIGHT: Side = { field: 'de la derecha', value: 'la derecha' };

function emptyIssue(operand: Operand, side: Side): ConditionIssue {
  return {
    code: 'CONDITION_OPERAND_EMPTY',
    message:
      operand.kind === 'ref'
        ? `Elige el campo ${side.field}.`
        : `Elige un valor para ${side.value}.`,
  };
}

function operandType(operand: Operand, scope: ReferenceScope, side: Side): Resolved {
  if (isEmpty(operand)) return { ok: false, issue: emptyIssue(operand, side) };
  if (operand.kind === 'literal') return { ok: true, type: { kind: operand.type } };
  const resolved = resolveReference(operand.path, scope);
  if (resolved.ok) return { ok: true, type: resolved.type };
  return { ok: false, issue: { code: resolved.code, message: resolved.message } };
}

const SCALARS = new Set(['string', 'number', 'boolean', 'datetime', 'enum']);

function comparable(a: DagType, b: DagType): boolean {
  return SCALARS.has(a.kind) && SCALARS.has(b.kind) && (isAssignable(a, b) || isAssignable(b, a));
}

function ordered(a: DagType, b: DagType): boolean {
  return (a.kind === 'number' || a.kind === 'datetime') && a.kind === b.kind;
}

const OP_WORDS: Record<string, string> = {
  eq: 'es igual a',
  neq: 'es distinto de',
  gt: 'es mayor que',
  gte: 'es mayor o igual que',
  lt: 'es menor que',
  lte: 'es menor o igual que',
  in: 'está entre',
};

function mismatch(op: string, a: DagType, b: DagType): ConditionIssue {
  return {
    code: 'CONDITION_TYPE_MISMATCH',
    message: `La comparación «${OP_WORDS[op] ?? op}» no se puede aplicar entre ${describeType(a)} y ${describeType(b)}.`,
  };
}

/** Checks the references and the operand types of a parsed condition. */
export function checkCondition(condition: Condition, scope: ReferenceScope): ConditionIssue[] {
  const issues: ConditionIssue[] = [];

  const visit = (c: Condition): void => {
    switch (c.op) {
      case 'and':
      case 'or':
        for (const child of c.operands) visit(child);
        return;
      case 'not':
        visit(c.operand);
        return;
      case 'exists': {
        const r = operandType(c.operand, scope, { field: 'que debe existir', value: 'el campo' });
        if (!r.ok) issues.push(r.issue);
        return;
      }
      case 'in': {
        const value = operandType(c.value, scope, { field: 'que se comparará', value: 'el valor' });
        if (!value.ok) {
          issues.push(value.issue);
          return;
        }
        c.options.forEach((option, index) => {
          if (isEmpty(option)) {
            issues.push(emptyIssue(option, { field: '', value: `la opción ${index + 1}` }));
            return;
          }
          const optionType: DagType = { kind: option.type };
          if (!comparable(value.type, optionType))
            issues.push(mismatch(c.op, value.type, optionType));
        });
        return;
      }
      default: {
        const left = operandType(c.left, scope, LEFT);
        const right = operandType(c.right, scope, RIGHT);
        if (!left.ok) issues.push(left.issue);
        if (!right.ok) issues.push(right.issue);
        if (!left.ok || !right.ok) return;
        const isOrdering = c.op !== 'eq' && c.op !== 'neq';
        const fine = isOrdering
          ? ordered(left.type, right.type)
          : comparable(left.type, right.type);
        if (!fine) issues.push(mismatch(c.op, left.type, right.type));
      }
    }
  };

  visit(condition);
  return issues;
}
