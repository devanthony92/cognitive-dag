import { describe, expect, it } from 'vitest';
import { validateDefinition } from '../src/index.js';
import { def, edge, node, trigger, type RawEdge, type RawNode } from './helpers.js';

/** Layered DAG with 50 nodes and exactly 100 connections, templates and conditions included. */
function bigDefinition() {
  const nodes: RawNode[] = [trigger('n0')];
  for (let i = 1; i < 50; i++) {
    const id = `n${i}`;
    if (i % 3 === 0) {
      nodes.push(
        node(id, 'llm.generate', {
          instruction: `Step ${i}: {{nodes.n0.output.message}} / {{nodes.n0.output.amount}}`,
        }),
      );
    } else if (i % 7 === 0) {
      nodes.push(node(id, 'logic.merge'));
    } else {
      nodes.push(node(id, 'mock.service'));
    }
  }
  const edges: RawEdge[] = [];
  for (let i = 0; i < 49; i++) edges.push(edge(`n${i}`, `n${i + 1}`));
  for (let i = 0; i < 48; i++) edges.push(edge(`n${i}`, `n${i + 2}`));
  for (let i = 0; i < 3; i++) edges.push(edge(`n${i}`, `n${i + 3}`));
  return def(nodes, edges);
}

describe('validation performance (SC-003)', () => {
  it('validates 50 nodes and 100 connections in under 100 ms', () => {
    const input = bigDefinition();
    expect(input.nodes).toHaveLength(50);
    expect(input.edges).toHaveLength(100);

    // First run includes JIT warm-up of a cold process, which is the worst case in a browser too.
    const start = performance.now();
    const result = validateDefinition(input);
    const elapsed = performance.now() - start;

    expect(result.errors).toEqual([]);
    expect(elapsed).toBeLessThan(100);

    const runs = 20;
    const warmStart = performance.now();
    for (let i = 0; i < runs; i++) validateDefinition(input);
    expect((performance.now() - warmStart) / runs).toBeLessThan(100);
  });
});
