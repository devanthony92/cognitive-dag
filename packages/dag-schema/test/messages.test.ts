import { describe, expect, it } from 'vitest';
import { NODE_CATALOG, NODE_TYPES, validateDefinition } from '../src/index.js';
import { def, node, trigger, type RawNode } from './helpers.js';

/** Errors of a definition with one node whose configuration is broken in one way. */
function errorsOf(broken: RawNode) {
  const result = validateDefinition(def([trigger(), broken]));
  return result.errors.filter((error) => error.location.node === broken.id);
}

function withConfig(type: Parameters<typeof node>[1], config: Record<string, unknown>) {
  const made = node('n', type);
  made.config = config;
  return made;
}

describe('schema messages are human Spanish tied to the field label', () => {
  it('names an empty list item by position', () => {
    const [error] = errorsOf(withConfig('llm.classify', { text: 'hola', labels: ['a', 'b', ''] }));
    expect(error?.message).toBe('La etiqueta 3 no puede estar vacía.');
    expect(error?.location).toEqual({ node: 'n', field: 'config.labels.2' });
  });

  it('says a missing field is required, using its label', () => {
    const [error] = errorsOf(withConfig('llm.classify', { labels: ['a', 'b'] }));
    expect(error?.message).toBe('El campo «Texto» es obligatorio.');
    expect(error?.location.field).toBe('config.text');
  });

  it('explains list size, text length and number ranges', () => {
    const few = errorsOf(withConfig('llm.classify', { text: 'hola', labels: ['solo'] }));
    expect(few[0]?.message).toBe('El campo «Etiquetas» debe tener al menos 2 elementos.');

    const long = errorsOf(
      withConfig('llm.classify', { text: 'x'.repeat(10_001), labels: ['a', 'b'] }),
    );
    expect(long[0]?.message).toBe('El campo «Texto» admite como máximo 10000 caracteres.');

    const small = errorsOf(
      withConfig('llm.generate', { instruction: 'hola', language: 'es', maxLength: 0 }),
    );
    expect(small[0]?.message).toBe('El campo «Longitud máxima» debe ser como mínimo 1.');
  });

  it('explains wrong types, options and formats', () => {
    const type = errorsOf(
      withConfig('llm.generate', { instruction: 'hola', language: 'es', maxLength: 'mucho' }),
    );
    expect(type[0]?.message).toBe('El campo «Longitud máxima» debe ser un número.');

    const option = errorsOf(withConfig('logic.merge', { strategy: 'ninguna' }));
    expect(option[0]?.message).toBe('El campo «Estrategia» debe ser uno de: all, any.');

    const format = errorsOf(withConfig('trigger.schedule', { cron: '0 9 * * *', timezone: '!!' }));
    expect(format[0]?.message).toBe('El campo «Zona horaria» no tiene un formato válido.');
  });

  it('names the row and the part of a typed field', () => {
    const errors = errorsOf(
      withConfig('llm.extract', {
        text: 'hola',
        fields: [
          { name: 'ok', type: { kind: 'string' } },
          { name: '', type: { kind: 'string' } },
        ],
      }),
    );
    expect(errors.some((e) => e.message === 'El campo 2 (nombre) no puede estar vacío.')).toBe(
      true,
    );
  });

  it('names the node label and keeps schema messages that are already Spanish', () => {
    const emptyLabel = node('n', 'logic.merge');
    emptyLabel.label = '';
    expect(errorsOf(emptyLabel)[0]?.message).toBe('El nombre del nodo no puede estar vacío.');

    const cron = errorsOf(withConfig('trigger.schedule', { cron: 'x', timezone: 'UTC' }));
    expect(cron[0]?.message).toBe('La expresión cron debe tener 5 campos.');
  });

  it('never shows the internal path in a message', () => {
    const broken = [
      withConfig('llm.classify', { labels: [1, '', null] }),
      withConfig('http.request', { method: 'FETCH', url: 5, headers: { a: 1 }, body: 3 }),
      withConfig('llm.extract', { text: '', fields: [{ name: 7 }, 'x'] }),
      withConfig('logic.condition', { condition: { op: 'zzz' } }),
      withConfig('human.approval', { message: '', timeoutSeconds: 'x' }),
    ];
    for (const one of broken) {
      for (const error of errorsOf(one)) {
        expect(error.message, `${one.type}: ${error.message}`).not.toMatch(
          /nodes\.\d|config\.|edges\.\d/,
        );
      }
    }
  });

  it('gives every catalog field a Spanish label', () => {
    for (const type of NODE_TYPES) {
      const entry = NODE_CATALOG[type];
      const keys = Object.keys((entry.defaultConfig() as Record<string, unknown>) ?? {});
      for (const key of keys) {
        expect(entry.fieldLabels[key], `${type}.${key}`).toEqual(expect.any(String));
      }
    }
  });
});
