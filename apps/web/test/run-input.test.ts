import { describe, expect, it } from 'vitest';
import type { FieldSpec } from '@cognitive-dag/dag-schema';
import { buildInputSchema, defaultValues, triggerFieldsOf } from '../src/features/runs/run-input';

const fields: FieldSpec[] = [
  { name: 'monto', type: { kind: 'number' } },
  { name: 'cliente', type: { kind: 'string' } },
  { name: 'vip', type: { kind: 'boolean' } },
  { name: 'plan', type: { kind: 'enum', values: ['basico', 'pro'] } },
  { name: 'cuando', type: { kind: 'datetime' } },
  { name: 'tags', type: { kind: 'list', item: { kind: 'string' } } },
  { name: 'datos', type: { kind: 'object', fields: { edad: { kind: 'number' } } } },
];

const valid = {
  monto: '150.5',
  cliente: 'Ana',
  vip: true,
  plan: 'pro',
  cuando: '2026-10-30T12:30',
  tags: '["a","b"]',
  datos: '{"edad": 30}',
};

describe('run input form model', () => {
  it('starts every field empty with a value of the control type', () => {
    expect(defaultValues(fields)).toEqual({
      monto: '',
      cliente: '',
      vip: false,
      plan: '',
      cuando: '',
      tags: '[]',
      datos: '{}',
    });
  });

  it('turns form values into the typed input the API expects', () => {
    const parsed = buildInputSchema(fields).safeParse(valid);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toMatchObject({
      monto: 150.5,
      cliente: 'Ana',
      vip: true,
      plan: 'pro',
      tags: ['a', 'b'],
      datos: { edad: 30 },
    });
    expect(parsed.data['cuando']).toBe(new Date('2026-10-30T12:30').toISOString());
  });

  it('reports one message per field in Spanish', () => {
    const parsed = buildInputSchema(fields).safeParse({
      ...valid,
      monto: 'abc',
      cliente: '',
      plan: '',
      cuando: '',
      tags: '[1]',
      datos: '{nope',
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const byField = new Map(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
    expect(byField.get('monto')).toBe('Debe ser un número.');
    expect(byField.get('cliente')).toBe('Es obligatorio.');
    expect(byField.get('plan')).toBe('Elige una opción.');
    expect(byField.get('cuando')).toBe('Es obligatorio.');
    expect(byField.get('tags')).toBe('Debe ser texto.');
    expect(byField.get('datos')).toBe('Debe ser JSON válido.');
  });

  it('reads the fields of the manual trigger from a definition', () => {
    const definition = {
      schemaVersion: 1,
      nodes: [
        { id: 'a', type: 'mock.service', label: 'A', position: { x: 0, y: 0 }, config: {} },
        {
          id: 'start',
          type: 'trigger.manual',
          label: 'Inicio',
          position: { x: 0, y: 0 },
          config: { inputSchema: [{ name: 'monto', type: { kind: 'number' } }] },
        },
      ],
      edges: [],
    };
    expect(triggerFieldsOf(definition)).toEqual([{ name: 'monto', type: { kind: 'number' } }]);
    expect(triggerFieldsOf({ nodes: [] })).toEqual([]);
  });
});
