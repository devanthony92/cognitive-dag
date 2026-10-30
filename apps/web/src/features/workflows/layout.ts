import dagre from '@dagrejs/dagre';
import type { DagDefinition } from '@cognitive-dag/dag-schema';

export interface NodeSize {
  width: number;
  height: number;
}

/** Size of a node on the canvas before React Flow has measured it. */
export const DEFAULT_NODE_SIZE: NodeSize = { width: 180, height: 56 };

const LAYER_GAP = 80;
const ROW_GAP = 40;

/**
 * Places the nodes in layers from left to right with dagre (research R8). Only positions change:
 * nodes keep their order, configuration and connections, so the logic of the DAG stays as it was.
 */
export function autoLayout(
  definition: DagDefinition,
  sizes: ReadonlyMap<string, NodeSize> = new Map(),
): DagDefinition {
  if (definition.nodes.length === 0) return definition;

  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: 'LR', ranksep: LAYER_GAP, nodesep: ROW_GAP, marginx: 0, marginy: 0 });
  graph.setDefaultEdgeLabel(() => ({}));

  const known = new Set<string>();
  for (const node of definition.nodes) {
    known.add(node.id);
    // dagre writes the result into the label it is given, so every node gets its own copy.
    graph.setNode(node.id, { ...(sizes.get(node.id) ?? DEFAULT_NODE_SIZE) });
  }
  for (const edge of definition.edges) {
    if (known.has(edge.source) && known.has(edge.target)) graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);

  return {
    ...definition,
    nodes: definition.nodes.map((node) => {
      const placed = graph.node(node.id) as { x: number; y: number };
      const size = sizes.get(node.id) ?? DEFAULT_NODE_SIZE;
      // dagre positions the center of the node; React Flow positions its top-left corner.
      return {
        ...node,
        position: {
          x: Math.round(placed.x - size.width / 2),
          y: Math.round(placed.y - size.height / 2),
        },
      };
    }),
  };
}
