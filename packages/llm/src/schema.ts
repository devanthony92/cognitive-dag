import type { DagType } from '@cognitive-dag/dag-schema';
import { z } from 'zod';

/** JSON Schema subset accepted by structured output (closed objects, no nulls). */
export type JsonSchema = Record<string, unknown>;

/**
 * JSON Schema of a node output for the provider's structured output (research R8): enums are
 * closed, objects are closed (`additionalProperties: false`) and require every field. No field of
 * a `DagType` admits null, so none of the schemas does.
 */
export function toJsonSchema(type: DagType): JsonSchema {
  switch (type.kind) {
    case 'string':
      return { type: 'string' };
    case 'number': {
      const schema: JsonSchema = { type: 'number' };
      if (type.min !== undefined) schema.minimum = type.min;
      if (type.max !== undefined) schema.maximum = type.max;
      return schema;
    }
    case 'boolean':
      return { type: 'boolean' };
    case 'datetime':
      return { type: 'string', format: 'date-time' };
    case 'enum':
      return { type: 'string', enum: [...type.values] };
    case 'list':
      return { type: 'array', items: toJsonSchema(type.item) };
    case 'object': {
      const names = Object.keys(type.fields);
      return {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(type.fields).map(([name, field]) => [name, toJsonSchema(field)]),
        ),
        required: names,
        additionalProperties: false,
      };
    }
  }
}

/** Zod validator equivalent to `toJsonSchema`: the guard never trusts the provider to obey it. */
export function toZodSchema(type: DagType): z.ZodType<unknown> {
  switch (type.kind) {
    case 'string':
      return z.string();
    case 'number': {
      let schema = z.number().finite();
      if (type.min !== undefined) schema = schema.min(type.min);
      if (type.max !== undefined) schema = schema.max(type.max);
      return schema;
    }
    case 'boolean':
      return z.boolean();
    case 'datetime':
      return z.iso.datetime({ offset: true });
    case 'enum':
      return z.enum(type.values as [string, ...string[]]);
    case 'list':
      return z.array(toZodSchema(type.item));
    case 'object':
      return z.strictObject(
        Object.fromEntries(
          Object.entries(type.fields).map(([name, field]) => [name, toZodSchema(field)]),
        ),
      );
  }
}
