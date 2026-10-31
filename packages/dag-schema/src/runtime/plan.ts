import { NODE_CATALOG, type ExecutableFrom, type NodeType } from '../catalog/index.js';
import type { DagDefinition, DagNode } from '../definition.js';

/** Phases whose nodes the interpreter can run. Later phases are blocked (FR-002). */
const EXECUTABLE_PHASES: readonly ExecutableFrom[] = ['F3'];

export interface UnsupportedNode {
  nodeId: string;
  type: NodeType;
  executableFrom: ExecutableFrom;
}

/** Nodes that become executable after F3: a version that contains any cannot be run. */
export function findUnsupportedNodes(definition: DagDefinition): UnsupportedNode[] {
  const unsupported: UnsupportedNode[] = [];
  for (const node of definition.nodes) {
    const { executableFrom } = NODE_CATALOG[node.type];
    if (!EXECUTABLE_PHASES.includes(executableFrom)) {
      unsupported.push({ nodeId: node.id, type: node.type, executableFrom });
    }
  }
  return unsupported;
}

export type StepState = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';

export interface RunState {
  statuses: ReadonlyMap<string, StepState>;
  /** Handle taken by each `logic.condition` that ran (`true` or `false`). */
  selections: ReadonlyMap<string, string>;
}

interface IncomingEdge {
  source: string;
  sourceHandle: string;
}

export interface ExecutionGraph {
  /** Node ids in definition order, so every plan is deterministic. */
  order: readonly string[];
  nodes: ReadonlyMap<string, DagNode>;
  incoming: ReadonlyMap<string, readonly IncomingEdge[]>;
}

export function buildExecutionGraph(definition: DagDefinition): ExecutionGraph {
  const nodes = new Map<string, DagNode>();
  const incoming = new Map<string, IncomingEdge[]>();
  for (const node of definition.nodes) {
    nodes.set(node.id, node);
    incoming.set(node.id, []);
  }
  for (const edge of definition.edges) {
    incoming.get(edge.target)?.push({ source: edge.source, sourceHandle: edge.sourceHandle });
  }
  return { order: definition.nodes.map((node) => node.id), nodes, incoming };
}

export interface Plan {
  /** Nodes to launch now (in parallel). */
  ready: string[];
  /** Nodes that will not run because no incoming branch was taken (cascade included). */
  skip: string[];
}

type EdgeFate = 'live' | 'dead' | 'open';

function edgeFate(
  edge: IncomingEdge,
  graph: ExecutionGraph,
  statuses: ReadonlyMap<string, StepState>,
  selections: ReadonlyMap<string, string>,
): EdgeFate {
  const status = statuses.get(edge.source);
  if (status === 'skipped') return 'dead';
  if (status !== 'succeeded') return 'open';
  if (graph.nodes.get(edge.source)?.type === 'logic.condition') {
    return selections.get(edge.source) === edge.sourceHandle ? 'live' : 'dead';
  }
  return 'live';
}

/**
 * Decides what to launch and what to skip, given the state of the run (research R1).
 *
 * An edge is live when its source ran and, for a condition, took that handle; dead when its source
 * was skipped or took the other handle; open while the source has not finished. A node needs all of
 * its incoming edges decided and at least one live (`all`, also the rule for any node with several
 * incoming edges), except a merge `any`, which goes on with the first live edge. A node with no live
 * edge once all are decided is skipped, and that cascades. After a failure or cancellation nothing
 * new is planned: the run fails fast.
 */
export function planNext(graph: ExecutionGraph, state: RunState): Plan {
  const statuses = new Map(state.statuses);
  for (const status of statuses.values()) {
    if (status === 'failed' || status === 'cancelled') return { ready: [], skip: [] };
  }

  const ready: string[] = [];
  const skip: string[] = [];
  for (let changed = true; changed;) {
    changed = false;
    for (const id of graph.order) {
      if (statuses.get(id) !== 'pending' || ready.includes(id)) continue;
      const edges = graph.incoming.get(id) ?? [];
      if (edges.length === 0) {
        ready.push(id);
        continue;
      }
      const fates = edges.map((edge) => edgeFate(edge, graph, statuses, state.selections));
      const live = fates.includes('live');
      const open = fates.includes('open');
      const node = graph.nodes.get(id);
      const isAnyMerge =
        node?.type === 'logic.merge' && (node.config as { strategy?: string }).strategy === 'any';
      if (live && (isAnyMerge || !open)) {
        ready.push(id);
      } else if (!live && !open) {
        statuses.set(id, 'skipped');
        skip.push(id);
        changed = true;
      }
    }
  }
  return { ready, skip };
}

/** True when no node is pending or running: every node reached a final state. */
export function isRunFinished(state: RunState): boolean {
  for (const status of state.statuses.values()) {
    if (status === 'pending' || status === 'running') return false;
  }
  return true;
}
