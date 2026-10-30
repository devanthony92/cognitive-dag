import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateDefinition, type DagDefinition } from '@cognitive-dag/dag-schema';
import { createNodeBuilder, buildEdges } from '../src/features/workflows/flow';
import { autoLayout } from '../src/features/workflows/layout';
import { groupErrors, moveNode } from '../src/features/workflows/model';
import { edge, FakeServer, mountEditor, node } from './editor-harness';

/** SC-004: 50 nodes and 100 connections: a trigger and 49 nodes, each fed by the two before it. */
function bigDraft(): DagDefinition {
  const nodes = [node('manual_1', 'trigger.manual', 'Disparo', { inputSchema: [] }, 0, 0)];
  for (let i = 1; i < 50; i++) {
    nodes.push(
      node(
        `generate_${i}`,
        'llm.generate',
        `Paso ${i}`,
        { instruction: `Paso ${i}`, language: 'es', maxLength: 100 },
        (i % 10) * 240,
        Math.floor(i / 10) * 120,
      ),
    );
  }
  const ids = nodes.map((n) => n.id);
  const edges = [];
  for (let i = 1; i < 50; i++) {
    edges.push(edge(`a${i}`, ids[i - 1] as string, ids[i] as string));
    if (i >= 2) edges.push(edge(`b${i}`, ids[i - 2] as string, ids[i] as string));
  }
  // 49 + 48 = 97; three more long jumps reach exactly 100.
  edges.push(edge('c1', ids[0] as string, ids[10] as string));
  edges.push(edge('c2', ids[0] as string, ids[20] as string));
  edges.push(edge('c3', ids[0] as string, ids[30] as string));
  return { schemaVersion: 1, nodes, edges } as unknown as DagDefinition;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('editor performance with 50 nodes and 100 connections (SC-004)', () => {
  it('the fixture is a real 50 / 100 graph and a valid one', () => {
    const big = bigDraft();
    expect(big.nodes).toHaveLength(50);
    expect(big.edges).toHaveLength(100);
    expect(validateDefinition(big).errors).toEqual([]);
  });

  it('moving one node rebuilds that node and reuses the other 49', () => {
    const build = createNodeBuilder();
    const errors = groupErrors([]);
    const first = build(bigDraft(), errors, new Set(), new Map(), false);
    const definition = bigDraft();
    const initial = build(definition, errors, new Set(), new Map(), false);
    const moved = build(
      moveNode(definition, 'generate_7', { x: 5, y: 5 }),
      errors,
      new Set(),
      new Map(),
      false,
    );

    expect(first).toHaveLength(50);
    const rebuilt = moved.filter((n, i) => n !== initial[i]);
    expect(rebuilt.map((n) => n.id)).toEqual(['generate_7']);
  });

  it('builds the connections of the canvas and lays out the graph well within a frame budget', () => {
    const big = bigDraft();
    const t0 = performance.now();
    const edges = buildEdges(big, groupErrors([]), new Set(), false);
    const laid = autoLayout(big);
    const elapsed = performance.now() - t0;

    expect(edges).toHaveLength(100);
    expect(laid.nodes).toHaveLength(50);
    // Generous on purpose: this is about not being quadratic, not about the speed of the runner.
    expect(elapsed).toBeLessThan(1000);
  });

  it('validates in the browser in under 100 ms (SC-003)', () => {
    const big = bigDraft();
    validateDefinition(big); // warm up the JIT, as a real session would have
    const t0 = performance.now();
    validateDefinition(big);
    expect(performance.now() - t0).toBeLessThan(100);
  });

  it('opens the editor with every node drawn and stays responsive when editing one', async () => {
    const server = new FakeServer(bigDraft());
    const { user } = mountEditor(server);

    await waitFor(() => expect(document.querySelectorAll('.react-flow__node')).toHaveLength(50), {
      timeout: 10_000,
    });

    fireEvent.click(screen.getByText('Paso 25'));
    const label = await screen.findByLabelText('Nombre del nodo');
    const t0 = performance.now();
    await user.clear(label);
    await user.type(label, 'Renombrado');
    await screen.findAllByText('Renombrado');
    // Eleven keystrokes with 50 nodes on screen: each one should not repaint the whole graph.
    expect(performance.now() - t0).toBeLessThan(5000);
  }, 30_000);
});
