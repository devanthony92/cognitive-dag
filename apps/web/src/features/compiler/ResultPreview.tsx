import { Background, Controls, ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo } from 'react';
import type { DagDefinition } from '@cognitive-dag/dag-schema';
import type { DraftValidation } from '@cognitive-dag/contracts';
import { CANVAS_ARIA_LABELS } from '../../components/station/a11y';
import { CanvasZoom, FitWhenReady } from '../../components/station/CanvasZoom';
import {
  buildEdges,
  EDGE_TYPES,
  NODE_TYPES,
  type FlowEdge,
  type FlowNode,
} from '../workflows/flow';
import { groupErrors } from '../workflows/model';

const NO_SELECTION: ReadonlySet<string> = new Set();

interface Props {
  definition: DagDefinition;
  errors: DraftValidation['errors'];
}

/** The generated DAG, read-only; nodes with validation problems are marked. */
export function ResultPreview({ definition, errors }: Props) {
  const grouped = useMemo(() => groupErrors(errors), [errors]);

  const nodes = useMemo<FlowNode[]>(
    () =>
      definition.nodes.map((source) => {
        const problems = grouped.byNode.get(source.id) ?? [];
        return {
          id: source.id,
          type: 'dag',
          position: source.position,
          draggable: false,
          deletable: false,
          connectable: false,
          data: {
            nodeType: source.type,
            label: source.label,
            errorCount: problems.length,
            errorTitle: problems.map((problem) => problem.message).join('. '),
          },
        };
      }),
    [definition.nodes, grouped],
  );

  const edges = useMemo<FlowEdge[]>(
    () =>
      buildEdges(definition, grouped, NO_SELECTION, true).map((edge) => ({
        ...edge,
        focusable: false,
      })),
    [definition, grouped],
  );

  return (
    <div className="h-96 w-full overflow-hidden rounded-lg border border-line">
      <ReactFlow<FlowNode, FlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        className="station-canvas"
        ariaLabelConfig={CANVAS_ARIA_LABELS}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
        fitView
        fitViewOptions={{ maxZoom: 1 }}
        minZoom={0.2}
        colorMode="system"
        aria-label="Vista previa del workflow generado"
      >
        <Background />
        <Controls showInteractive={false} fitViewOptions={{ maxZoom: 1 }} />
        <CanvasZoom />
        <FitWhenReady minZoom={0.2} />
      </ReactFlow>
    </div>
  );
}
