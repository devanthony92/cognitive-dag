import { validateDefinition } from '@cognitive-dag/dag-schema';
import { describe, expect, it } from 'vitest';
import { edgeIds, layoutPositions, LAYER_GAP_X, ROW_GAP_Y, toDefinition } from '../src/index.js';
import { classifyAndBranch } from './fixtures.js';

describe('translation to DagDefinition (research R6)', () => {
  it('produces a valid definition of schema version 1', () => {
    const definition = toDefinition(classifyAndBranch());
    expect(definition.schemaVersion).toBe(1);
    expect(definition.nodes).toHaveLength(5);
    const result = validateDefinition(definition);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('names edges <from>-<fromHandle>-<to>', () => {
    const definition = toDefinition(classifyAndBranch());
    expect(definition.edges[2]).toEqual({
      id: 'is_spam-true-archive',
      source: 'is_spam',
      sourceHandle: 'true',
      target: 'archive',
    });
  });

  it('falls back to e<n> when the name is too long or repeated', () => {
    const long = 'a'.repeat(40);
    expect(
      edgeIds([
        { from: long, fromHandle: 'out', to: long },
        { from: 'a', fromHandle: 'out', to: 'b' },
        { from: 'a', fromHandle: 'out', to: 'b' },
      ]),
    ).toEqual(['e1', 'a-out-b', 'e3']);
  });
});

describe('layered layout (research R6)', () => {
  it('places each node at its longest distance from the trigger, without overlaps', () => {
    const dag = classifyAndBranch();
    const positions = layoutPositions(dag.nodes, dag.edges);
    expect(positions.start).toEqual({ x: 0, y: 0 });
    expect(positions.classify?.x).toBe(LAYER_GAP_X);
    expect(positions.is_spam?.x).toBe(2 * LAYER_GAP_X);
    expect(positions.archive?.x).toBe(3 * LAYER_GAP_X);
    expect(positions.reply?.x).toBe(3 * LAYER_GAP_X);
    expect(Math.abs((positions.archive?.y ?? 0) - (positions.reply?.y ?? 0))).toBe(ROW_GAP_Y);
    const keys = Object.values(positions).map((p) => `${p.x},${p.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('puts a merge after the longest branch', () => {
    const nodes = ['t', 'a', 'b1', 'b2', 'm'].map((id) => ({ id }));
    const edges = [
      { from: 't', to: 'a' },
      { from: 't', to: 'b1' },
      { from: 'b1', to: 'b2' },
      { from: 'a', to: 'm' },
      { from: 'b2', to: 'm' },
    ];
    expect(layoutPositions(nodes, edges).m?.x).toBe(3 * LAYER_GAP_X);
  });

  it('is deterministic and survives cycles and unknown ids', () => {
    const nodes = ['t', 'a', 'b'].map((id) => ({ id }));
    const edges = [
      { from: 't', to: 'a' },
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' },
      { from: 'ghost', to: 't' },
    ];
    const first = layoutPositions(nodes, edges);
    expect(layoutPositions(nodes, edges)).toEqual(first);
    expect(Object.keys(first).sort()).toEqual(['a', 'b', 't']);
    const keys = Object.values(first).map((p) => `${p.x},${p.y}`);
    expect(new Set(keys).size).toBe(3);
  });
});
