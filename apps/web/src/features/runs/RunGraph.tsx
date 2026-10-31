import { Background, Controls, ReactFlow, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useMemo } from 'react';
import type { RunStep } from '@cognitive-dag/contracts';
import type { DagDefinition } from '@cognitive-dag/dag-schema';
import { DagNodeView } from '../workflows/DagNodeView';
import { buildEdges, type FlowNode } from '../workflows/flow';
import { groupErrors } from '../workflows/model';

const NODE_TYPES = { dag: DagNodeView };
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
        return {
          id: source.id,
          type: 'dag',
          position: source.position,
          selected: source.id === selectedId,
          draggable: false,
          deletable: false,
          connectable: false,
          data: {
            nodeType: source.type,
            label: source.label,
            errorCount: 0,
            errorTitle: '',
            ...(step ? { status: step.status } : {}),
            ...(step?.waitingReason === 'rate_limited' ? { waiting: true } : {}),
          },
        };
      }),
    [definition.nodes, byNode, selectedId],
  );

  const edges = useMemo<Edge[]>(
    () =>
      buildEdges(definition, NO_ERRORS, NO_SELECTION, true).map((edge) => ({
        ...edge,
        focusable: false,
        // The branch that is running right now.
        animated: byNode.get(edge.target)?.status === 'running',
        ...(byNode.get(edge.target)?.status === 'skipped' ? { style: { opacity: 0.35 } } : {}),
      })),
    [definition, byNode],
  );

  return (
    <ReactFlow<FlowNode, Edge>
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
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
    </ReactFlow>
  );
}
