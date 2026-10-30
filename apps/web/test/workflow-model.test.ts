import { describe, expect, it } from 'vitest';
import { emptyDefinition, validateDefinition, type DagDefinition } from '@cognitive-dag/dag-schema';
import { buildEdges } from '../src/features/workflows/flow';
import {
  addNode,
  connect,
  groupErrors,
  moveNode,
  removeEdges,
  removeNodes,
  toEditableDefinition,
  updateNode,
} from '../src/features/workflows/model';

function twoNodes(): DagDefinition {
  let { definition } = addNode(emptyDefinition(), 'trigger.manual', { x: 0, y: 0 });
  ({ definition } = addNode(definition, 'llm.generate', { x: 200, y: 0 }));
  return definition;
}

describe('workflow model', () => {
  it('adds nodes with unique ids, the default config and a valid type', () => {
    const first = addNode(emptyDefinition(), 'llm.classify', { x: 1, y: 2 });
    const second = addNode(first.definition, 'llm.classify', { x: 3, y: 4 });

    expect(first.id).toBe('classify_1');
    expect(second.id).toBe('classify_2');
    expect(second.definition.nodes).toHaveLength(2);
    expect(second.definition.nodes[0]).toMatchObject({
      type: 'llm.classify',
      position: { x: 1, y: 2 },
      config: { labels: ['positivo', 'negativo'] },
    });
    expect(validateDefinition(second.definition).errors.map((e) => e.code)).not.toContain(
      'SCHEMA_INVALID',
    );
  });

  it('connects a handle to a target once and ignores duplicates', () => {
    const base = twoNodes();
    const once = connect(base, { source: 'manual_1', sourceHandle: 'out', target: 'generate_1' });
    const twice = connect(once, { source: 'manual_1', sourceHandle: 'out', target: 'generate_1' });

    expect(once.edges).toHaveLength(1);
    expect(twice.edges).toHaveLength(1);
    expect(validateDefinition(twice).valid).toBe(true);
  });

  it('gives every connection a distinct id even after removals', () => {
    let definition = twoNodes();
    definition = connect(definition, {
      source: 'manual_1',
      sourceHandle: 'out',
      target: 'generate_1',
    });
    definition = removeEdges(
      definition,
      definition.edges.map((e) => e.id),
    );
    definition = connect(definition, {
      source: 'manual_1',
      sourceHandle: 'out',
      target: 'generate_1',
    });
    definition = connect(definition, {
      source: 'generate_1',
      sourceHandle: 'out',
      target: 'generate_1',
    });

    expect(new Set(definition.edges.map((e) => e.id)).size).toBe(2);
  });

  it('removes a node together with its connections', () => {
    let definition = twoNodes();
    definition = connect(definition, {
      source: 'manual_1',
      sourceHandle: 'out',
      target: 'generate_1',
    });
    const removed = removeNodes(definition, ['generate_1']);

    expect(removed.nodes.map((n) => n.id)).toEqual(['manual_1']);
    expect(removed.edges).toEqual([]);
  });

  it('moves and updates a node without touching the rest', () => {
    const base = twoNodes();
    const moved = moveNode(base, 'generate_1', { x: 10, y: 20 });
    const updated = updateNode(moved, 'generate_1', { label: 'Resumir' });

    expect(updated.nodes[1]).toMatchObject({ position: { x: 10, y: 20 }, label: 'Resumir' });
    expect(updated.nodes[0]).toBe(base.nodes[0]);
  });

  it('groups validation errors by node, connection and field', () => {
    const grouped = groupErrors([
      { code: 'A', message: 'nodo', location: { node: 'a', field: 'config.text' } },
      { code: 'B', message: 'arista', location: { edge: 'e1' } },
      { code: 'CYCLE_DETECTED', message: 'ciclo', location: { nodes: ['a', 'b'] } },
      { code: 'TRIGGER_MISSING', message: 'global', location: {} },
    ]);

    expect(grouped.byNode.get('a')?.map((e) => e.code)).toEqual(['A', 'CYCLE_DETECTED']);
    expect(grouped.byNode.get('b')?.map((e) => e.code)).toEqual(['CYCLE_DETECTED']);
    expect(grouped.byEdge.get('e1')).toHaveLength(1);
    expect(grouped.global.map((e) => e.code)).toEqual(['TRIGGER_MISSING']);
    expect(grouped.fieldMessages('a', 'config.text')).toEqual(['nodo']);
    expect(grouped.fieldMessages('a', 'config.labels')).toEqual([]);
  });

  it('keeps what the editor can draw from a draft and counts what it drops', () => {
    const { definition, skipped } = toEditableDefinition({
      schemaVersion: 1,
      nodes: [
        { id: 'a', type: 'trigger.manual', label: 'A', position: { x: 1, y: 2 }, config: {} },
        { id: 'b', type: 'nope.unknown', label: 'B', position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [{ id: 'e1', source: 'a' }],
    });

    expect(definition.nodes.map((n) => n.id)).toEqual(['a']);
    expect(definition.edges).toEqual([]);
    expect(skipped).toBe(2);
    expect(toEditableDefinition(null).definition).toEqual(emptyDefinition());
  });

  it('marks the connections that have errors and names the branch of a multi-output node', () => {
    let definition = twoNodes();
    ({ definition } = addNode(definition, 'logic.condition', { x: 0, y: 0 }));
    definition = connect(definition, {
      source: 'manual_1',
      sourceHandle: 'true',
      target: 'generate_1',
    });
    definition = connect(definition, {
      source: 'condition_1',
      sourceHandle: 'false',
      target: 'generate_1',
    });
    const errors = groupErrors([
      { code: 'EDGE_HANDLE_INVALID', message: 'sin salida', location: { edge: 'e1' } },
    ]);

    const [broken, branch] = buildEdges(definition, errors, new Set(), false);

    expect(broken?.className).toBe('has-errors');
    expect(broken?.label).toBeUndefined();
    expect(branch?.className).toBeUndefined();
    expect(branch?.label).toBe('No');
  });
});
