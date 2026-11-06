import { SCHEMA_VERSION, type DagDefinition, type NodeType } from '@cognitive-dag/dag-schema';
import type { IntermediateDag, IntermediateEdge } from './intermediate.js';
import { layoutPositions } from './layout.js';

const EDGE_ID = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * Ids of the edges (research R6): `<from>-<fromHandle>-<to>`, or `e<n>` (1-based) when that name
 * does not fit the edge id format or repeats an earlier one.
 */
export function edgeIds(edges: readonly IntermediateEdge[]): string[] {
  const seen = new Set<string>();
  return edges.map((edge, index) => {
    const name = `${edge.from}-${edge.fromHandle}-${edge.to}`;
    const id = EDGE_ID.test(name) && !seen.has(name) ? name : `e${index + 1}`;
    seen.add(id);
    return id;
  });
}

/**
 * Translates the intermediate DAG to a `DagDefinition` of F2 with layered positions. It does not
 * validate: the result goes through `validateDefinition`, the single authority on its shape.
 */
export function toDefinition(dag: IntermediateDag): DagDefinition {
  const positions = layoutPositions(dag.nodes, dag.edges);
  const ids = edgeIds(dag.edges);
  return {
    schemaVersion: SCHEMA_VERSION,
    nodes: dag.nodes.map((node) => ({
      id: node.id,
      type: node.type as NodeType,
      label: node.label,
      position: positions[node.id] ?? { x: 0, y: 0 },
      config: node.config,
    })),
    edges: dag.edges.map((edge, index) => ({
      id: ids[index] as string,
      source: edge.from,
      sourceHandle: edge.fromHandle,
      target: edge.to,
    })),
  };
}
