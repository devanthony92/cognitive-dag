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

/** Milliseconds one call takes. */
function timeOnce(input: ReturnType<typeof bigDefinition>): number {
  const start = performance.now();
  validateDefinition(input);
  return performance.now() - start;
}

describe('validation performance (SC-003)', () => {
  it('validates 50 nodes and 100 connections in under 100 ms', () => {
    const input = bigDefinition();
    expect(input.nodes).toHaveLength(50);
    expect(input.edges).toHaveLength(100);

    // The first call of a cold process also pays module loading and JIT compilation, and on a shared
    // CI runner, where Turbo runs every package's tests at once, it swings with the load of the
    // machine (it went over 100 ms several times with no change in the validator). It only guards
    // against a gross regression; SC-003 is measured on the warm calls below.
    const start = performance.now();
    const result = validateDefinition(input);
    const cold = performance.now() - start;
    expect(result.errors).toEqual([]);
    expect(cold).toBeLessThan(1000);

    // SC-003: the editor validates on every change, so the user-facing time is the warm call. The
    // median of 21 calls ignores the odd pause of the garbage collector or a busy runner.
    const samples = Array.from({ length: 21 }, () => timeOnce(input)).sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)] ?? Number.POSITIVE_INFINITY;
    expect(median).toBeLessThan(100);
  });
});
