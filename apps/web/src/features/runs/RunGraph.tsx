import { Background, Controls, ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo } from 'react';
import type { RunStep } from '@cognitive-dag/contracts';
import type { DagDefinition } from '@cognitive-dag/dag-schema';
import { CANVAS_ARIA_LABELS } from '../../components/station/a11y';
import { CanvasZoom } from '../../components/station/CanvasZoom';
import { stationDescription } from '../../components/station/Station';
import { serviceStateOf, statusLabelOf } from '../../components/status/service-state';
import {
  buildEdges,
  EDGE_TYPES,
  NODE_TYPES,
  type FlowEdge,
  type FlowNode,
} from '../workflows/flow';
import { groupErrors } from '../workflows/model';

const NO_ERRORS = groupErrors([]);
const NO_SELECTION: ReadonlySet<string> = new Set();

interface Props {
  definition: DagDefinition;
  steps: readonly RunStep[];
  selectedId: string | undefined;
  onSelect: (nodeId: string | undefined) => void;
}

/** The graph of the version that ran, read-only, with the state of every node on top. */
export function RunGraph({ definition, steps, selectedId, onSelect }: Props) {
  const byNode = useMemo(() => new Map(steps.map((step) => [step.nodeId, step])), [steps]);

  const nodes = useMemo<FlowNode[]>(
    () =>
      definition.nodes.map((source) => {
        const step = byNode.get(source.id);
        const subject = step
          ? ({ kind: 'step', status: step.status, waitingReason: step.waitingReason } as const)
          : undefined;
        const state = subject ? serviceStateOf(subject) : undefined;
        const stateLabel = subject ? statusLabelOf(subject) : undefined;
        // A waiting step says why in text under the station: the glyph alone would not.
        const waiting = state === 'waiting';
        return {
          id: source.id,
          type: 'dag',
          position: source.position,
          selected: source.id === selectedId,
          draggable: false,
          deletable: false,
          connectable: false,
          ariaLabel: stationDescription({
            type: source.type,
            label: source.label,
            ...(stateLabel ? { stateLabel } : {}),
          }),
          data: {
            nodeType: source.type,
            label: source.label,
            errorCount: 0,
            errorTitle: '',
            ...(state ? { state } : {}),
            ...(stateLabel && !waiting ? { stateLabel } : {}),
            ...(waiting && stateLabel ? { note: stateLabel } : {}),
          },
        };
      }),
    [definition.nodes, byNode, selectedId],
  );

  const edges = useMemo<FlowEdge[]>(
    () =>
      buildEdges(definition, NO_ERRORS, NO_SELECTION, true).map((edge) => ({
        ...edge,
        focusable: false,
        // The branch that is running right now.
        animated: byNode.get(edge.target)?.status === 'running',
        data: { ...edge.data, dimmed: byNode.get(edge.target)?.status === 'skipped' },
      })),
    [definition, byNode],
  );

  return (
    <ReactFlow<FlowNode, FlowEdge>
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      className="station-canvas"
      ariaLabelConfig={CANVAS_ARIA_LABELS}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
      deleteKeyCode={null}
      onNodeClick={(_, node) => onSelect(node.id)}
      onPaneClick={() => onSelect(undefined)}
      fitView
      fitViewOptions={{ maxZoom: 1 }}
      minZoom={0.2}
      colorMode="system"
      aria-label="Grafo de la ejecución"
    >
      <Background />
      <Controls showInteractive={false} fitViewOptions={{ maxZoom: 1 }} />
      <CanvasZoom />
    </ReactFlow>
  );
}
