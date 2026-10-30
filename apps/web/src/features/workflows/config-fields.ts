import { z } from 'zod';
import { NODE_CATALOG, type NodeType } from '@cognitive-dag/dag-schema';

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'checkbox'
  | 'string-list'
  | 'field-list'
  | 'key-value'
  | 'json';

export interface FieldDescriptor {
  key: string;
  label: string;
  kind: FieldKind;
  options?: string[];
  integer?: boolean;
  min?: number;
  max?: number;
  required: boolean;
}

/** A declared field of a trigger or an extraction: a name and a type of `dag-schema`. */
export interface TypedField {
  name: string;
  type: Record<string, unknown>;
}

/** A row of a name → text map (HTTP headers). */
export interface KeyValueRow {
  key: string;
  value: string;
}

export type ListValue = string[] | TypedField[] | KeyValueRow[];
export type FormValue = string | boolean | ListValue;

/** Spanish captions for the configuration keys of the catalog. */
const LABELS: Record<string, string> = {
  inputSchema: 'Campos de entrada',
  bodySchema: 'Campos del cuerpo',
  cron: 'Expresión cron',
  timezone: 'Zona horaria',
  text: 'Texto',
  labels: 'Etiquetas',
  fields: 'Campos a extraer',
  instruction: 'Instrucción',
  language: 'Idioma',
  maxLength: 'Longitud máxima',
  condition: 'Condición',
  strategy: 'Estrategia',
  message: 'Mensaje',
  timeoutSeconds: 'Plazo (segundos)',
  method: 'Método',
  url: 'URL',
  headers: 'Cabeceras',
  body: 'Cuerpo',
  latencyMs: 'Latencia (ms)',
  failureRate: 'Tasa de fallos (0 a 1)',
  failureKind: 'Tipo de fallo',
};

interface JsonProperty {
  type?: string;
  enum?: unknown[];
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  items?: { type?: string; properties?: Record<string, unknown> };
  properties?: Record<string, unknown>;
  additionalProperties?: { type?: string } | boolean;
}

const cache = new Map<NodeType, FieldDescriptor[]>();

function listKind(property: JsonProperty): FieldKind | undefined {
  if (property.type === 'array' && property.items?.type === 'string') return 'string-list';
  if (
    property.type === 'array' &&
    property.items?.type === 'object' &&
    property.items.properties?.['name'] !== undefined &&
    property.items.properties['type'] !== undefined
  ) {
    return 'field-list';
  }
  if (
    property.type === 'object' &&
    property.properties === undefined &&
    typeof property.additionalProperties === 'object' &&
    property.additionalProperties.type === 'string'
  ) {
    return 'key-value';
  }
  return undefined;
}

/**
 * One form field per top-level key of the node's `configSchema`. Scalars get their own control,
 * lists of strings, lists of typed fields and text maps get row editors, and only what has no
 * other shape (the condition tree, until PR 4's builder) falls back to JSON.
 */
export function describeConfig(type: NodeType): FieldDescriptor[] {
  const known = cache.get(type);
  if (known) return known;

  const entry = NODE_CATALOG[type];
  const jsonSchema = z.toJSONSchema(entry.configSchema, {
    io: 'input',
    unrepresentable: 'any',
  }) as { properties?: Record<string, JsonProperty>; required?: string[] };
  const required = new Set(jsonSchema.required ?? []);

  const descriptors = Object.entries(jsonSchema.properties ?? {}).map(
    ([key, property]): FieldDescriptor => {
      const base = { key, label: LABELS[key] ?? key, required: required.has(key) };
      if (Array.isArray(property.enum)) {
        return { ...base, kind: 'select', options: property.enum.map(String) };
      }
      if (property.type === 'boolean') return { ...base, kind: 'checkbox' };
      if (property.type === 'integer' || property.type === 'number') {
        return {
          ...base,
          kind: 'number',
          integer: property.type === 'integer',
          ...(property.minimum !== undefined ? { min: property.minimum } : {}),
          ...(property.maximum !== undefined ? { max: property.maximum } : {}),
        };
      }
      if (property.type === 'string') {
        const long = entry.templatableFields.includes(key) || (property.maxLength ?? 0) >= 500;
        return { ...base, kind: long ? 'textarea' : 'text' };
      }
      return { ...base, kind: listKind(property) ?? 'json' };
    },
  );
  cache.set(type, descriptors);
  return descriptors;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function toFormValue(descriptor: FieldDescriptor, value: unknown): FormValue {
  switch (descriptor.kind) {
    case 'checkbox':
      return value === true;
    case 'json':
      return value === undefined ? '' : JSON.stringify(value, null, 2);
    case 'string-list':
      return Array.isArray(value)
        ? value.map((item) => (typeof item === 'string' ? item : ''))
        : [];
    case 'field-list':
      return Array.isArray(value)
        ? value.map((item): TypedField => {
            const row = isRecord(item) ? item : {};
            return {
              name: typeof row['name'] === 'string' ? row['name'] : '',
              type: isRecord(row['type']) ? row['type'] : { kind: 'string' },
            };
          })
        : [];
    case 'key-value':
      return isRecord(value)
        ? Object.entries(value).map(([key, text]): KeyValueRow => ({
            key,
            value: typeof text === 'string' ? text : '',
          }))
        : [];
    default:
      return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  }
}

export type ParsedValue = { ok: true; value: unknown } | { ok: false };

/** Turns what the user typed back into a config value; `undefined` leaves the key out. */
export function fromFormValue(descriptor: FieldDescriptor, raw: FormValue): ParsedValue {
  if (descriptor.kind === 'checkbox') return { ok: true, value: raw === true };
  if (typeof raw !== 'string') {
    if (descriptor.kind === 'key-value') {
      const rows = raw as KeyValueRow[];
      return { ok: true, value: Object.fromEntries(rows.map((row) => [row.key, row.value])) };
    }
    return { ok: true, value: raw };
  }
  switch (descriptor.kind) {
    case 'number': {
      if (raw.trim() === '') return { ok: true, value: undefined };
      const value = Number(raw);
      return Number.isNaN(value) ? { ok: true, value: undefined } : { ok: true, value };
    }
    case 'json': {
      if (raw.trim() === '') return { ok: true, value: undefined };
      try {
        return { ok: true, value: JSON.parse(raw) as unknown };
      } catch {
        return { ok: false };
      }
    }
    default:
      return { ok: true, value: raw };
  }
}
