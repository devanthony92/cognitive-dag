/** Horizontal distance between layers and vertical distance between rows (research R6). */
export const LAYER_GAP_X = 280;
export const ROW_GAP_Y = 140;

export interface Position {
  x: number;
  y: number;
}

/**
 * Layered layout without dependencies (research R6): a node's layer is its longest distance from
 * a node without inputs; nodes of a layer stack in the order they were declared. Nodes left in a
 * cycle go to one extra layer, so even an invalid DAG gets positions without overlaps. Edges to
 * unknown ids are ignored. Deterministic: the same input gives the same positions.
 */
export function layoutPositions(
  nodes: readonly { id: string }[],
  edges: readonly { from: string; to: string }[],
): Record<string, Position> {
  const ids = [...new Set(nodes.map((node) => node.id))];
  const known = new Set(ids);
  const incoming = new Map(ids.map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const edge of edges) {
    if (!known.has(edge.from) || !known.has(edge.to)) continue;
    outgoing.get(edge.from)?.push(edge.to);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }

  const layer = new Map<string, number>();
  const queue = ids.filter((id) => incoming.get(id) === 0);
  for (const id of queue) layer.set(id, 0);
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index] as string;
    for (const next of outgoing.get(id) ?? []) {
      layer.set(next, Math.max(layer.get(next) ?? 0, (layer.get(id) ?? 0) + 1));
      const left = (incoming.get(next) ?? 0) - 1;
      incoming.set(next, left);
      if (left === 0) queue.push(next);
    }
  }
  const deepest = Math.max(-1, ...layer.values());
  for (const id of ids) if (!queue.includes(id)) layer.set(id, deepest + 1);

  const rows = new Map<number, number>();
  const positions: Record<string, Position> = {};
  for (const id of ids) {
    const column = layer.get(id) ?? 0;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    positions[id] = { x: column * LAYER_GAP_X, y: row * ROW_GAP_Y };
  }
  return positions;
}
