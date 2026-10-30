import { z } from 'zod';
import { NODE_CATALOG, type NodeType } from '@cognitive-dag/dag-schema';

export type FieldKind = 'text' | 'textarea' | 'number' | 'select' | 'checkbox' | 'json';

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

export type FormValue = string | boolean;

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
}

const cache = new Map<NodeType, FieldDescriptor[]>();

/**
 * One form field per top-level key of the node's `configSchema`. Scalars get their own control;
 * lists, objects and conditions fall back to a JSON field, validated by the schema as the user
 * types (PR 4 replaces the references, templates and conditions with dedicated widgets).
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
      return { ...base, kind: 'json' };
    },
  );
  cache.set(type, descriptors);
  return descriptors;
}

export function toFormValue(descriptor: FieldDescriptor, value: unknown): FormValue {
  switch (descriptor.kind) {
    case 'checkbox':
      return value === true;
    case 'json':
      return value === undefined ? '' : JSON.stringify(value, null, 2);
    default:
      return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  }
}

export type ParsedValue = { ok: true; value: unknown } | { ok: false };

/** Turns what the user typed back into a config value; `undefined` leaves the key out. */
export function fromFormValue(descriptor: FieldDescriptor, raw: FormValue): ParsedValue {
  if (descriptor.kind === 'checkbox') return { ok: true, value: raw === true };
  const text = typeof raw === 'string' ? raw : '';
  switch (descriptor.kind) {
    case 'number': {
      if (text.trim() === '') return { ok: true, value: undefined };
      const value = Number(text);
      return Number.isNaN(value) ? { ok: true, value: undefined } : { ok: true, value };
    }
    case 'json': {
      if (text.trim() === '') return { ok: true, value: undefined };
      try {
        return { ok: true, value: JSON.parse(text) as unknown };
      } catch {
        return { ok: false };
      }
    }
    default:
      return { ok: true, value: text };
  }
}
