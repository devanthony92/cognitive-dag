import type { z } from 'zod';
import { NODE_CATALOG, isNodeType } from './catalog/index.js';

type RawIssue = z.core.$ZodRawIssue;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Names of the parts of a typed field, for messages such as «El campo 2 (nombre)». */
const PART_LABELS: Record<string, string> = {
  name: 'nombre',
  type: 'tipo',
  kind: 'tipo',
  values: 'valores',
  item: 'elementos',
  fields: 'campos',
};

const NODE_PARTS: Record<string, string> = {
  label: 'El nombre del nodo',
  id: 'El identificador del nodo',
  type: 'El tipo del nodo',
  position: 'La posición del nodo',
  config: 'La configuración del nodo',
};

const EXPECTED: Record<string, string> = {
  string: 'un texto',
  number: 'un número',
  int: 'un número entero',
  boolean: 'verdadero o falso',
  array: 'una lista',
  object: 'un objeto',
};

/** What the issue is about, with its article: «El campo «Texto»», «La etiqueta 3». */
function subjectOf(path: readonly PropertyKey[], raw: unknown): string {
  const [head, index, ...rest] = path;
  if (head === 'nodes' && typeof index === 'number') {
    const node =
      isRecord(raw) && Array.isArray(raw['nodes']) ? (raw['nodes'] as unknown[])[index] : undefined;
    const type = isRecord(node) ? node['type'] : undefined;
    const [part, key, ...below] = rest;
    if (part !== 'config') {
      const named = typeof part === 'string' ? NODE_PARTS[part] : undefined;
      return named ?? 'El nodo';
    }
    if (typeof key !== 'string') return NODE_PARTS['config'] as string;
    const entry = isNodeType(type) ? NODE_CATALOG[type] : undefined;
    const label = entry?.fieldLabels[key] ?? key;
    const item = entry?.itemLabels?.[key];
    const [position, ...parts] = below;
    if (position === undefined) return `El campo «${label}»`;
    const named =
      typeof position === 'number'
        ? `${item ?? `El elemento de «${label}»`} ${position + 1}`
        : `${item ?? 'El elemento'} «${String(position)}»`;
    const part2 = parts.find((p): p is string => typeof p === 'string' && p in PART_LABELS);
    return part2 === undefined ? named : `${named} (${PART_LABELS[part2]})`;
  }
  if (head === 'edges' && typeof index === 'number') {
    return `La conexión ${index + 1}`;
  }
  return 'La definición';
}

/** `masculine` or `feminine` form of an adjective, following the subject's article. */
const agree = (subject: string, masculine: string, feminine: string) =>
  subject.startsWith('La ') ? feminine : masculine;

/**
 * The Spanish message of a schema issue (research R7, FR-004): it names the field the way the
 * editor does and never the internal path, which stays in `location`. Schema-level messages
 * written in Spanish win over these, because the parser only asks this function when there is none.
 */
export function schemaMessage(raw: unknown, issue: RawIssue): string | undefined {
  const path = issue.path ?? [];
  const subject = subjectOf(path, raw);

  switch (issue.code) {
    case 'invalid_type':
      if (issue.input === undefined)
        return `${subject} ${agree(subject, 'es obligatorio', 'es obligatoria')}.`;
      return `${subject} debe ser ${EXPECTED[issue.expected] ?? 'de otro tipo'}.`;
    case 'too_small': {
      const min = Number(issue.minimum);
      if (issue.origin === 'string') {
        return min <= 1
          ? `${subject} no puede estar ${agree(subject, 'vacío', 'vacía')}.`
          : `${subject} debe tener al menos ${min} caracteres.`;
      }
      if (issue.origin === 'array' || issue.origin === 'set') {
        return `${subject} debe tener al menos ${min} ${min === 1 ? 'elemento' : 'elementos'}.`;
      }
      return issue.inclusive === false
        ? `${subject} debe ser mayor que ${min}.`
        : `${subject} debe ser como mínimo ${min}.`;
    }
    case 'too_big': {
      const max = Number(issue.maximum);
      if (issue.origin === 'string') return `${subject} admite como máximo ${max} caracteres.`;
      if (issue.origin === 'array' || issue.origin === 'set') {
        return `${subject} admite como máximo ${max} elementos.`;
      }
      return issue.inclusive === false
        ? `${subject} debe ser menor que ${max}.`
        : `${subject} debe ser como máximo ${max}.`;
    }
    case 'invalid_value': {
      const values = issue.values.map(String);
      return values.length > 0 && values.length <= 8
        ? `${subject} debe ser uno de: ${values.join(', ')}.`
        : `${subject} tiene un valor no permitido.`;
    }
    case 'invalid_format': {
      if (issue.input === '')
        return `${subject} no puede estar ${agree(subject, 'vacío', 'vacía')}.`;
      const last = path[path.length - 1];
      const hint =
        last === 'name' || last === 'id'
          ? ' Debe empezar con una letra minúscula y usar a-z, 0-9 o _ (máx. 40).'
          : '';
      return `${subject} no tiene un formato válido.${hint}`;
    }
    case 'unrecognized_keys':
      return undefined; // reported on its own as UNKNOWN_FIELD
    default:
      return `${subject} no ${agree(subject, 'es válido', 'es válida')}.`;
  }
}
