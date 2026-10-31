import { NODE_CATALOG, type NodeType } from '../src/index.js';

export interface RawNode {
  id: string;
  type: string;
  label: string;
  position: { x: number; y: number };
  config: unknown;
  retry?: unknown;
}

export interface RawEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
}

export interface RawDefinition {
  schemaVersion: number;
  nodes: RawNode[];
  edges: RawEdge[];
}

export function node(id: string, type: NodeType, config: Record<string, unknown> = {}): RawNode {
  return {
    id,
    type,
    label: id,
    position: { x: 0, y: 0 },
    config: { ...(NODE_CATALOG[type].defaultConfig() as Record<string, unknown>), ...config },
  };
}

export function edge(source: string, target: string, sourceHandle = 'out'): RawEdge {
  return { id: `${source}_${sourceHandle}_${target}`, source, sourceHandle, target };
}

export function def(nodes: RawNode[], edges: RawEdge[] = []): RawDefinition {
  return { schemaVersion: 1, nodes, edges };
}

/** Manual trigger with a typed input schema, used as the root of most tests. */
export function trigger(id = 'trigger'): RawNode {
  return node(id, 'trigger.manual', {
    inputSchema: [
      { name: 'message', type: { kind: 'string' } },
      { name: 'amount', type: { kind: 'number' } },
      { name: 'tone', type: { kind: 'enum', values: ['happy', 'sad'] } },
    ],
  });
}
