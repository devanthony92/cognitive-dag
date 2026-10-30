import { z } from 'zod';

/** Minimal type system for references (research R4). */
export type DagType =
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'datetime' }
  | { kind: 'enum'; values: string[] }
  | { kind: 'object'; fields: Record<string, DagType> }
  | { kind: 'list'; item: DagType };

/** Identifier used for field names inside objects and declared fields. */
export const FieldNameSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]{0,39}$/,
    'Debe empezar con una letra minúscula y usar a-z, 0-9 o _ (máx. 40).',
  );

export const MAX_TYPE_NESTING = 4;

const EnumValuesSchema = z
  .array(z.string().min(1).max(50))
  .min(1)
  .max(50)
  .refine((values) => new Set(values).size === values.length, 'Los valores no pueden repetirse.');

const scalarTypes = [
  z.strictObject({ kind: z.literal('string') }),
  z.strictObject({ kind: z.literal('number') }),
  z.strictObject({ kind: z.literal('boolean') }),
  z.strictObject({ kind: z.literal('datetime') }),
  z.strictObject({ kind: z.literal('enum'), values: EnumValuesSchema }),
] as const;

/** Built level by level so nesting is bounded without recursive schemas. */
function typeSchemaAt(level: number): z.ZodType<DagType> {
  if (level === 0) return z.union(scalarTypes);
  const inner = typeSchemaAt(level - 1);
  return z.union([
    ...scalarTypes,
    z.strictObject({
      kind: z.literal('object'),
      fields: z.record(FieldNameSchema, inner).refine((f) => Object.keys(f).length <= 50),
    }),
    z.strictObject({ kind: z.literal('list'), item: inner }),
  ]);
}

/** Type a user can declare for a field (trigger inputs, extracted fields). */
export const FieldTypeSchema: z.ZodType<DagType> = typeSchemaAt(MAX_TYPE_NESTING);

/** A declared field: a name and a type. */
export const FieldSpecSchema = z.strictObject({ name: FieldNameSchema, type: FieldTypeSchema });
export type FieldSpec = z.infer<typeof FieldSpecSchema>;

/** Declared fields with unique names. */
export function fieldListSchema(max: number, min = 0) {
  return z
    .array(FieldSpecSchema)
    .min(min)
    .max(max)
    .refine((fields) => new Set(fields.map((f) => f.name)).size === fields.length, {
      message: 'Los nombres de los campos no pueden repetirse.',
    });
}

export function fieldsToObject(fields: readonly FieldSpec[]): DagType {
  const result: Record<string, DagType> = {};
  for (const field of fields) result[field.name] = field.type;
  return { kind: 'object', fields: result };
}

/** True when a value of type `source` can be used where `target` is expected. */
export function isAssignable(source: DagType, target: DagType): boolean {
  switch (target.kind) {
    case 'string':
      return source.kind === 'string' || source.kind === 'enum';
    case 'number':
    case 'boolean':
    case 'datetime':
      return source.kind === target.kind;
    case 'enum': {
      if (source.kind !== 'enum') return false;
      const allowed = new Set(target.values);
      return source.values.every((v) => allowed.has(v));
    }
    case 'list':
      return source.kind === 'list' && isAssignable(source.item, target.item);
    case 'object': {
      if (source.kind !== 'object') return false;
      return Object.entries(target.fields).every(([name, fieldType]) => {
        const sourceField = Object.hasOwn(source.fields, name) ? source.fields[name] : undefined;
        return sourceField !== undefined && isAssignable(sourceField, fieldType);
      });
    }
  }
}

/** Types that can be written inside a template. */
export function isTextConvertible(type: DagType): boolean {
  return type.kind !== 'object' && type.kind !== 'list';
}

export function describeType(type: DagType): string {
  switch (type.kind) {
    case 'enum':
      return `enum<${type.values.join(' | ')}>`;
    case 'list':
      return `list<${describeType(type.item)}>`;
    case 'object':
      return `object<${Object.entries(type.fields)
        .map(([name, t]) => `${name}: ${describeType(t)}`)
        .join(', ')}>`;
    default:
      return type.kind;
  }
}
