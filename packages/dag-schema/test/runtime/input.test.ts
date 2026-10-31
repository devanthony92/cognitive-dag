import { describe, expect, it } from 'vitest';
import { validateTriggerInput, type FieldSpec } from '../../src/index.js';

const fields: FieldSpec[] = [
  { name: 'monto', type: { kind: 'number' } },
  { name: 'nota', type: { kind: 'string' } },
  { name: 'activo', type: { kind: 'boolean' } },
  { name: 'cuando', type: { kind: 'datetime' } },
  { name: 'nivel', type: { kind: 'enum', values: ['alto', 'bajo'] } },
  { name: 'tags', type: { kind: 'list', item: { kind: 'string' } } },
  { name: 'cliente', type: { kind: 'object', fields: { id: { kind: 'number' } } } },
];

const valid = {
  monto: 10,
  nota: 'x',
  activo: true,
  cuando: '2026-10-30T12:00:00Z',
  nivel: 'alto',
  tags: ['a'],
  cliente: { id: 1 },
};

describe('validateTriggerInput', () => {
  it('accepts a value of every declared type', () => {
    expect(validateTriggerInput(fields, valid)).toEqual([]);
  });

  it('accepts anything when no fields are declared, but only an empty object', () => {
    expect(validateTriggerInput([], {})).toEqual([]);
    expect(validateTriggerInput([], { a: 1 })).toHaveLength(1);
  });

  it('reports a missing field, an unknown field and a wrong type, by path', () => {
    const errors = validateTriggerInput(fields, {
      ...valid,
      monto: '10',
      extra: 1,
      tags: [1],
      cliente: { id: 'x' },
      nivel: 'medio',
      cuando: 'ayer',
      nota: undefined,
    });
    expect(errors.map((error) => error.field).sort()).toEqual(
      ['cliente.id', 'cuando', 'extra', 'monto', 'nivel', 'nota', 'tags.0'].sort(),
    );
  });

  it('rejects non-finite numbers and inherited keys', () => {
    expect(validateTriggerInput(fields, { ...valid, monto: Number.NaN })).toHaveLength(1);
    const inherited = Object.create({ monto: 1 }) as Record<string, unknown>;
    expect(validateTriggerInput([fields[0]!], inherited)).toHaveLength(1);
  });
});
