import { z } from 'zod';
import { validateTriggerInput, type DagType, type FieldSpec } from '@cognitive-dag/dag-schema';

/** What each control holds: text for typed fields, a checkbox for booleans. */
export type FormValues = Record<string, string | boolean>;

/** Fields declared by the manual trigger of a (published) definition. */
export function triggerFieldsOf(definition: unknown): FieldSpec[] {
  const nodes = (definition as { nodes?: unknown } | null)?.nodes;
  if (!Array.isArray(nodes)) return [];
  for (const node of nodes as Array<{ type?: unknown; config?: unknown }>) {
    if (node.type !== 'trigger.manual') continue;
    const inputSchema = (node.config as { inputSchema?: unknown } | undefined)?.inputSchema;
    return Array.isArray(inputSchema) ? (inputSchema as FieldSpec[]) : [];
  }
  return [];
}

/** Lists and objects are typed as JSON text; everything else gets its own control. */
export const isJsonType = (type: DagType): boolean =>
  type.kind === 'list' || type.kind === 'object';

export function defaultValues(fields: readonly FieldSpec[]): FormValues {
  const values: FormValues = {};
  for (const { name, type } of fields) {
    values[name] =
      type.kind === 'boolean'
        ? false
        : type.kind === 'list'
          ? '[]'
          : type.kind === 'object'
            ? '{}'
            : '';
  }
  return values;
}

const REQUIRED = 'Es obligatorio.';

function fieldSchema(field: FieldSpec): z.ZodType<unknown> {
  const { type } = field;
  switch (type.kind) {
    case 'boolean':
      return z.boolean();
    case 'string':
      return z.string().min(1, REQUIRED);
    case 'number':
      return z.string().transform((raw, ctx) => {
        const text = raw.trim();
        const value = Number(text);
        if (text === '') ctx.issues.push({ code: 'custom', message: REQUIRED, input: raw });
        else if (!Number.isFinite(value)) {
          ctx.issues.push({ code: 'custom', message: 'Debe ser un número.', input: raw });
        }
        return value;
      });
    case 'datetime':
      return z.string().transform((raw, ctx) => {
        if (raw === '') ctx.issues.push({ code: 'custom', message: REQUIRED, input: raw });
        const date = new Date(raw);
        if (raw !== '' && Number.isNaN(date.getTime())) {
          ctx.issues.push({ code: 'custom', message: 'Debe ser una fecha y hora.', input: raw });
          return raw;
        }
        return raw === '' ? raw : date.toISOString();
      });
    case 'enum':
      return z.string().refine((value) => type.values.includes(value), 'Elige una opción.');
    default:
      return z.string().transform((raw, ctx) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          ctx.issues.push({ code: 'custom', message: 'Debe ser JSON válido.', input: raw });
          return undefined;
        }
        const [first] = validateTriggerInput([field], { [field.name]: parsed });
        if (first) ctx.issues.push({ code: 'custom', message: first.message, input: raw });
        return parsed;
      });
  }
}

/** Zod schema that turns the form values into the input the API validates again. */
export function buildInputSchema(fields: readonly FieldSpec[]) {
  return z.object(Object.fromEntries(fields.map((field) => [field.name, fieldSchema(field)])));
}
