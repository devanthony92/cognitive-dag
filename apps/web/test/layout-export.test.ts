import { describe, expect, it } from 'vitest';
import {
  DagDefinitionSchema,
  validateDefinition,
  type DagDefinition,
} from '@cognitive-dag/dag-schema';
import { autoLayout } from '../src/features/workflows/layout';
import { exportFileName, serializeDefinition } from '../src/features/workflows/export';

const node = (id: string, type: string, config: unknown, x: number, y: number) => ({
  id,
  type,
  label: id,
  position: { x, y },
  config,
});
const edge = (id: string, source: string, target: string, sourceHandle = 'out') => ({
  id,
  source,
  sourceHandle,
  target,
});

/** Scrambled on purpose: the diamond manual → (a, b) → merge. */
const scrambled = (): DagDefinition =>
  ({
    schemaVersion: 1,
    nodes: [
      node('merge_1', 'logic.merge', { strategy: 'all' }, 5, 5),
      node('generate_a', 'llm.generate', { instruction: 'A', language: 'es', maxLength: 10 }, 5, 5),
      node('manual_1', 'trigger.manual', { inputSchema: [] }, 5, 5),
      node('generate_b', 'llm.generate', { instruction: 'B', language: 'es', maxLength: 10 }, 5, 5),
    ],
    edges: [
      edge('e1', 'manual_1', 'generate_a'),
      edge('e2', 'manual_1', 'generate_b'),
      edge('e3', 'generate_a', 'merge_1'),
      edge('e4', 'generate_b', 'merge_1'),
    ],
  }) as unknown as DagDefinition;

describe('autoLayout', () => {
  it('puts every connection from left to right, in layers', () => {
    const laid = autoLayout(scrambled());
    const at = (id: string) =>
      laid.nodes.find((n) => n.id === id)?.position as { x: number; y: number };

    for (const e of laid.edges) expect(at(e.source).x).toBeLessThan(at(e.target).x);
    expect(at('generate_a').x).toBe(at('generate_b').x);
    expect(at('generate_a').y).not.toBe(at('generate_b').y);
  });

  it('does not overlap nodes', () => {
    const laid = autoLayout(scrambled());
    const keys = laid.nodes.map((n) => `${n.position.x}:${n.position.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('changes positions only: the logic stays as it was', () => {
    const before = scrambled();
    const laid = autoLayout(before);
    const strip = (d: DagDefinition) => ({
      ...d,
      nodes: d.nodes.map(({ position: _position, ...rest }) => rest),
    });
    expect(strip(laid)).toEqual(strip(before));
    expect(validateDefinition(laid).errors).toEqual(validateDefinition(before).errors);
  });

  it('is deterministic and does not mutate its input', () => {
    const before = scrambled();
    const snapshot = JSON.stringify(before);
    expect(autoLayout(before)).toEqual(autoLayout(before));
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('copes with an empty graph, with nodes without connections and with broken edges', () => {
    expect(autoLayout({ schemaVersion: 1, nodes: [], edges: [] })).toEqual({
      schemaVersion: 1,
      nodes: [],
      edges: [],
    });
    const loose = scrambled();
    loose.edges.push(edge('e9', 'nope', 'merge_1'));
    expect(() => autoLayout(loose)).not.toThrow();
  });

  it('uses the measured sizes so wide nodes do not collide', () => {
    const sizes = new Map([['manual_1', { width: 400, height: 80 }]]);
    const laid = autoLayout(scrambled(), sizes);
    const manual = laid.nodes.find((n) => n.id === 'manual_1')?.position.x as number;
    const next = laid.nodes.find((n) => n.id === 'generate_a')?.position.x as number;
    expect(next - manual).toBeGreaterThanOrEqual(400);
  });
});

describe('serializeDefinition', () => {
  it('produces JSON that parses back and validates with the schema', () => {
    const json = serializeDefinition(autoLayout(scrambled()));
    const parsed: unknown = JSON.parse(json);
    expect(DagDefinitionSchema.safeParse(parsed).success).toBe(true);
    expect(validateDefinition(parsed).valid).toBe(true);
  });

  it('is pretty printed with a trailing newline, for readable diffs', () => {
    const json = serializeDefinition(scrambled());
    expect(json.split('\n').length).toBeGreaterThan(10);
    expect(json.endsWith('\n')).toBe(true);
  });
});

describe('exportFileName', () => {
  it('builds a safe file name from the workflow name', () => {
    expect(exportFileName('Reembolsos de Mayo')).toBe('reembolsos-de-mayo.json');
    expect(exportFileName('Atención al cliente / ¡Urgente!')).toBe(
      'atencion-al-cliente-urgente.json',
    );
    expect(exportFileName('Soporte', 3)).toBe('soporte-v3.json');
    expect(exportFileName('???')).toBe('workflow.json');
  });
});
