import { describe, expect, it } from 'vitest';
import {
  DagDefinitionSchema,
  NodeIdSchema,
  SCHEMA_VERSION,
  emptyDefinition,
} from '../src/index.js';
import { def, edge, node, trigger } from './helpers.js';

describe('NodeIdSchema', () => {
  it.each(['a', 'trigger', 'classify_2', 'a'.repeat(40)])('accepts %s', (id) => {
    expect(NodeIdSchema.safeParse(id).success).toBe(true);
  });

  it.each(['', 'A', '1abc', '_a', 'a-b', 'a b', 'a'.repeat(41), 'ñandú'])('rejects %s', (id) => {
    expect(NodeIdSchema.safeParse(id).success).toBe(false);
  });
});

describe('DagDefinitionSchema', () => {
  it('accepts the shape of research R2', () => {
    const result = DagDefinitionSchema.safeParse(
      def(
        [trigger(), node('classify', 'llm.classify', { labels: ['a', 'b'] })],
        [edge('trigger', 'classify')],
      ),
    );
    expect(result.success).toBe(true);
  });

  it('exposes schemaVersion 1 and an empty definition', () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(emptyDefinition()).toEqual({ schemaVersion: 1, nodes: [], edges: [] });
    expect(DagDefinitionSchema.safeParse(emptyDefinition()).success).toBe(true);
  });

  it('rejects another schemaVersion', () => {
    expect(DagDefinitionSchema.safeParse({ ...def([trigger()]), schemaVersion: 2 }).success).toBe(
      false,
    );
    expect(DagDefinitionSchema.safeParse({ nodes: [], edges: [] }).success).toBe(false);
  });

  it('rejects unknown fields at every level', () => {
    const base = def([trigger()], []);
    const first = base.nodes[0]!;
    expect(DagDefinitionSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(
      DagDefinitionSchema.safeParse({ ...base, nodes: [{ ...first, extra: 1 }] }).success,
    ).toBe(false);
    expect(
      DagDefinitionSchema.safeParse({
        ...base,
        nodes: [{ ...first, config: { ...(first.config as object), extra: 1 } }],
      }).success,
    ).toBe(false);
    expect(
      DagDefinitionSchema.safeParse({ ...base, edges: [{ ...edge('a', 'b'), extra: 1 }] }).success,
    ).toBe(false);
    expect(
      DagDefinitionSchema.safeParse({
        ...base,
        nodes: [{ ...first, position: { x: 0, y: 0, z: 1 } }],
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown node type and invalid node ids', () => {
    expect(DagDefinitionSchema.safeParse(def([{ ...trigger(), type: 'code.run' }])).success).toBe(
      false,
    );
    expect(DagDefinitionSchema.safeParse(def([{ ...trigger(), id: 'Bad-Id' }])).success).toBe(
      false,
    );
  });

  it('rejects non-finite positions and empty or long labels', () => {
    const t = trigger();
    expect(
      DagDefinitionSchema.safeParse(def([{ ...t, position: { x: Infinity, y: 0 } }])).success,
    ).toBe(false);
    expect(DagDefinitionSchema.safeParse(def([{ ...t, label: '' }])).success).toBe(false);
    expect(DagDefinitionSchema.safeParse(def([{ ...t, label: 'x'.repeat(101) }])).success).toBe(
      false,
    );
  });

  it('leaves uniqueness to semantic validation, which reports locations', () => {
    expect(DagDefinitionSchema.safeParse(def([trigger('a'), trigger('a')])).success).toBe(true);
  });
});
