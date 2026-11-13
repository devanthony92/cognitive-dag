import { NODE_CATALOG, type DagDefinition, type DagNode } from '@cognitive-dag/dag-schema';
import { categoryOfType } from '../../components/category/categories';
import { HANDLE_LABELS } from '../../components/station/a11y';
import { StationEdge, type StationEdgeType } from '../../components/station/StationEdge';
import { stationDescription } from '../../components/station/Station';
import {
  StationNode,
  type StationFlowNode,
  type StationNodeData,
} from '../../components/station/StationNode';
import type { GroupedErrors } from './model';

export { HANDLE_LABELS };

export type DagNodeData = StationNodeData;
export type FlowNode = StationFlowNode;
export type FlowEdge = StationEdgeType;

/** Every node of a canvas is a station and every connection a line of the plan (research R9). */
export const NODE_TYPES = { dag: StationNode };
export const EDGE_TYPES = { station: StationEdge };

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
        ariaLabel: stationDescription({
          type: source.type,
          label: source.label,
          problems: nodeErrors?.length ?? 0,
        }),
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

interface CachedEdge {
  source: DagDefinition['edges'][number];
  from: string;
  to: string;
  fromType: string | undefined;
  selected: boolean;
  readOnly: boolean;
  problems: readonly unknown[] | undefined;
  out: FlowEdge;
}

/**
 * Builds the lines of the canvas: a station edge per connection, in the colour of the category of its
 * source, named after its two ends, with the branch («Sí», «No»…) when the source has several outputs.
 * Like the node builder it keeps the object of a line that did not change, so typing in the panel
 * does not make React Flow redraw the other 99 lines.
 */
export function createEdgeBuilder() {
  const cache = new Map<string, CachedEdge>();
  return (
    definition: DagDefinition,
    errors: GroupedErrors,
    selected: ReadonlySet<string>,
    readOnly: boolean,
  ): FlowEdge[] => {
    const byId = new Map(definition.nodes.map((node) => [node.id, node]));
    const live = new Set<string>();
    const edges = definition.edges.map((edge) => {
      live.add(edge.id);
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      const problems = errors.byEdge.get(edge.id);
      const from = source?.label ?? edge.source;
      const to = target?.label ?? edge.target;
      const isSelected = selected.has(edge.id);
      const hit = cache.get(edge.id);
      if (
        hit &&
        hit.source === edge &&
        hit.from === from &&
        hit.to === to &&
        hit.fromType === source?.type &&
        hit.selected === isSelected &&
        hit.readOnly === readOnly &&
        hit.problems === problems
      ) {
        return hit.out;
      }
      const branching = source ? NODE_CATALOG[source.type].handles.length > 1 : false;
      const label = branching ? (HANDLE_LABELS[edge.sourceHandle] ?? edge.sourceHandle) : undefined;
      const problem = problems?.map((error) => error.message).join('. ');
      const out: FlowEdge = {
        id: edge.id,
        type: 'station',
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        selected: isSelected,
        deletable: !readOnly,
        focusable: true,
        ariaLabel: [`Conexión de «${from}»${label ? ` (${label})` : ''} a «${to}»`, problem]
          .filter(Boolean)
          .join('. '),
        data: {
          category: source ? categoryOfType(source.type) : undefined,
          ...(problem ? { problem } : {}),
        },
        ...(label ? { label } : {}),
        ...(problem ? { className: 'has-errors' } : {}),
      };
      cache.set(edge.id, {
        source: edge,
        from,
        to,
        fromType: source?.type,
        selected: isSelected,
        readOnly,
        problems,
        out,
      });
      return out;
    });
    for (const id of cache.keys()) if (!live.has(id)) cache.delete(id);
    return edges;
  };
}

/** One-off build, for the read-only canvases (run view, draft preview). */
export function buildEdges(
  definition: DagDefinition,
  errors: GroupedErrors,
  selected: ReadonlySet<string>,
  readOnly: boolean,
): FlowEdge[] {
  return createEdgeBuilder()(definition, errors, selected, readOnly);
}
