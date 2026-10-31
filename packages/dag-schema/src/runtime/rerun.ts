import { NODE_CATALOG } from '../catalog/index.js';
import type { DagDefinition } from '../definition.js';
import type { StepState } from './plan.js';

export type ReusablePlan = { ok: true; reusable: string[] } | { ok: false; code: 'NODE_NOT_FOUND' };

/** Nodes with an effect are the ones worth not running twice; logic is pure and runs again. */
const EFFECT_CATEGORIES = new Set(['llm', 'integration', 'mock']);

/**
 * Which nodes of a finished run a rerun from `fromNodeId` can reuse (research R6, FR-016): the
 * nodes with an effect that succeeded and neither are the chosen node nor depend on it.
 * They come out in the order of the definition.
 */
export function computeReusable(
  definition: DagDefinition,
  statuses: ReadonlyMap<string, StepState>,
  fromNodeId: string,
): ReusablePlan {
  if (!definition.nodes.some((node) => node.id === fromNodeId)) {
    return { ok: false, code: 'NODE_NOT_FOUND' };
  }
  const outgoing = new Map<string, string[]>();
  for (const edge of definition.edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }
  const affected = new Set<string>([fromNodeId]);
  const queue = [fromNodeId];
  for (let i = 0; i < queue.length; i++) {
    for (const next of outgoing.get(queue[i] as string) ?? []) {
      if (!affected.has(next)) {
        affected.add(next);
        queue.push(next);
      }
    }
  }
  const reusable = definition.nodes
    .filter(
      (node) =>
        EFFECT_CATEGORIES.has(NODE_CATALOG[node.type].category) &&
        statuses.get(node.id) === 'succeeded' &&
        !affected.has(node.id),
    )
    .map((node) => node.id);
  return { ok: true, reusable };
}
