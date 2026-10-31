import type { DagType, FieldSpec } from '../types.js';

export interface InputError {
  /** Dotted path of the value, e.g. `cliente.id` or `tags.0`. */
  field: string;
  message: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function check(type: DagType, value: unknown, path: string, errors: InputError[]): void {
  const fail = (message: string) => errors.push({ field: path, message });
  switch (type.kind) {
    case 'string':
      if (typeof value !== 'string') fail('Debe ser texto.');
      return;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) fail('Debe ser un número.');
      return;
    case 'boolean':
      if (typeof value !== 'boolean') fail('Debe ser verdadero o falso.');
      return;
    case 'datetime':
      if (typeof value !== 'string' || !DATETIME.test(value) || Number.isNaN(Date.parse(value))) {
        fail('Debe ser una fecha y hora ISO 8601.');
      }
      return;
    case 'enum':
      if (typeof value !== 'string' || !type.values.includes(value)) {
        fail(`Debe ser uno de: ${type.values.join(', ')}.`);
      }
      return;
    case 'list':
      if (!Array.isArray(value)) {
        fail('Debe ser una lista.');
        return;
      }
      value.forEach((item, index) => check(type.item, item, `${path}.${index}`, errors));
      return;
    case 'object':
      if (!isRecord(value)) {
        fail('Debe ser un objeto.');
        return;
      }
      checkFields(type.fields, value, path, errors);
  }
}

function checkFields(
  declared: Readonly<Record<string, DagType>>,
  value: Record<string, unknown>,
  prefix: string,
  errors: InputError[],
): void {
  const at = (name: string) => (prefix === '' ? name : `${prefix}.${name}`);
  for (const [name, type] of Object.entries(declared)) {
    if (!Object.hasOwn(value, name) || value[name] === undefined) {
      errors.push({ field: at(name), message: 'Es obligatorio.' });
    } else {
      check(type, value[name], at(name), errors);
    }
  }
  for (const name of Object.keys(value)) {
    if (!Object.hasOwn(declared, name)) {
      errors.push({ field: at(name), message: 'No es un campo del disparador.' });
    }
  }
}

/**
 * Checks the input of a run against the fields of `trigger.manual`: every declared field is
 * required, has its declared type, and nothing else is accepted. Pure: no coercion.
 */
export function validateTriggerInput(
  fields: readonly FieldSpec[],
  input: Record<string, unknown>,
): InputError[] {
  const errors: InputError[] = [];
  const declared: Record<string, DagType> = {};
  for (const field of fields) declared[field.name] = field.type;
  checkFields(declared, input, '', errors);
  return errors;
}
