import { describe, expect, it } from 'vitest';
import { fillSensitivePlaceholders, stripSensitive, type SensitiveLookup } from '../src/index.js';
import type { IntermediateDag } from '../src/index.js';

/** Catalog of tests: no executable type has sensitive fields in F6 (research R12). */
const lookup: SensitiveLookup = (type) =>
  type === 'test.send'
    ? {
        sensitiveFields: ['to', 'amount'],
        defaultConfig: () => ({ to: 'x@example.test', amount: 1, note: '' }),
      }
    : undefined;

function dag(config: Record<string, unknown>): IntermediateDag {
  return {
    title: 'Enviar',
    nodes: [
      { id: 'start', type: 'trigger.manual', label: 'Inicio', config: { inputSchema: [] } },
      { id: 'send', type: 'test.send', label: 'Enviar', config },
    ],
    edges: [{ from: 'start', fromHandle: 'out', to: 'send' }],
  };
}

describe('sensitive fields (research R12, US4)', () => {
  it('drops sensitive fields the model filled and lists them', () => {
    const { dag: clean, omitted } = stripSensitive(
      dag({ to: 'attacker@evil.test', amount: 999, note: 'hola' }),
      lookup,
    );
    expect(clean.nodes[1]?.config).toEqual({ note: 'hola' });
    expect(omitted).toEqual([
      { nodeId: 'send', field: 'to' },
      { nodeId: 'send', field: 'amount' },
    ]);
  });

  it('lists a sensitive field as omitted even when the model left it out', () => {
    const { omitted } = stripSensitive(dag({ note: 'hola' }), lookup);
    expect(omitted).toEqual([
      { nodeId: 'send', field: 'to' },
      { nodeId: 'send', field: 'amount' },
    ]);
  });

  it('leaves nodes without sensitive fields untouched and never mutates the input', () => {
    const input = dag({ to: 'a@b.test', note: 'n' });
    const before = JSON.stringify(input);
    const { dag: clean } = stripSensitive(input, lookup);
    expect(JSON.stringify(input)).toBe(before);
    expect(clean.nodes[0]).toEqual(input.nodes[0]);
  });

  it('fills placeholders from the default config so the rest can be validated', () => {
    const filled = fillSensitivePlaceholders(dag({ to: 'attacker@evil.test', note: 'n' }), lookup);
    expect(filled.nodes[1]?.config).toEqual({ to: 'x@example.test', amount: 1, note: 'n' });
  });
});
