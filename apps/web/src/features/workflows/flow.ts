import type { Edge, Node } from '@xyflow/react';
import {
  NODE_CATALOG,
  type DagDefinition,
  type DagNode,
  type NodeType,
} from '@cognitive-dag/dag-schema';
import type { StepStatus } from '@cognitive-dag/contracts';
import type { GroupedErrors } from './model';

export interface DagNodeData extends Record<string, unknown> {
  nodeType: NodeType;
  label: string;
  errorCount: number;
  errorTitle: string;
  /** State of the node in a run; only the run view sets it. */
  status?: StepStatus;
  /** The running node is held back by the rate limit (F4). */
  waiting?: boolean;
}

export type FlowNode = Node<DagNodeData, 'dag'>;

export const HANDLE_LABELS: Record<string, string> = {
  true: 'Sí',
  false: 'No',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  timeout: 'Vencido',
};

interface Cached {
  source: DagNode;
  selected: boolean;
  readOnly: boolean;
  errors: readonly unknown[] | undefined;
  measured: { width: number; height: number } | undefined;
  out: FlowNode;
}

/**
 * Builds the React Flow nodes from the definition. Nodes that did not change keep the same
 * object, so dragging one of 50 nodes does not make React Flow re-diff the other 49.
 */
export function createNodeBuilder() {
  const cache = new Map<string, Cached>();
  return (
    definition: DagDefinition,
    errors: GroupedErrors,
    selected: ReadonlySet<string>,
    measured: ReadonlyMap<string, { width: number; height: number }>,
    readOnly: boolean,
  ): FlowNode[] => {
    const live = new Set<string>();
    const nodes = definition.nodes.map((source) => {
      live.add(source.id);
      const nodeErrors = errors.byNode.get(source.id);
      const isSelected = selected.has(source.id);
      const size = measured.get(source.id);
      const hit = cache.get(source.id);
      if (
        hit &&
        hit.source === source &&
        hit.selected === isSelected &&
        hit.readOnly === readOnly &&
        hit.errors === nodeErrors &&
        hit.measured === size
      ) {
        return hit.out;
      }
      const out: FlowNode = {
        id: source.id,
        type: 'dag',
        position: source.position,
        selected: isSelected,
        draggable: !readOnly,
        deletable: !readOnly,
        ...(size ? { measured: size } : {}),
        data: {
          nodeType: source.type,
          label: source.label,
          errorCount: nodeErrors?.length ?? 0,
          errorTitle: (nodeErrors ?? []).map((error) => error.message).join('\n'),
        },
      };
      cache.set(source.id, {
        source,
        selected: isSelected,
        readOnly,
        errors: nodeErrors,
        measured: size,
        out,
      });
      return out;
    });
    for (const id of cache.keys()) if (!live.has(id)) cache.delete(id);
    return nodes;
  };
}

export function buildEdges(
  definition: DagDefinition,
  errors: GroupedErrors,
  selected: ReadonlySet<string>,
  readOnly: boolean,
): Edge[] {
  const handleCount = new Map(
    definition.nodes.map((node) => [node.id, NODE_CATALOG[node.type].handles.length]),
  );
  return definition.edges.map((edge) => {
    const failing = errors.byEdge.has(edge.id);
    const label =
      (handleCount.get(edge.source) ?? 0) > 1
        ? (HANDLE_LABELS[edge.sourceHandle] ?? edge.sourceHandle)
        : undefined;
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      selected: selected.has(edge.id),
      deletable: !readOnly,
      focusable: true,
      ...(label ? { label } : {}),
      ...(failing
        ? {
            className: 'has-errors',
            style: { stroke: 'var(--destructive)', strokeWidth: 2 },
            ariaLabel: (errors.byEdge.get(edge.id) ?? []).map((e) => e.message).join('. '),
          }
        : {}),
    };
  });
}
