import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { NODE_CATALOG, type NodeType } from '@cognitive-dag/dag-schema';
import { cn } from '../../lib/utils';
import type { ServiceState } from '../status/statusGlyphs';
import { HANDLE_LABELS } from './a11y';
import { Station } from './Station';

export interface StationNodeData extends Record<string, unknown> {
  nodeType: NodeType;
  label: string;
  errorCount: number;
  errorTitle: string;
  /** State of the step in a run, as a design state, and its Spanish name. */
  state?: ServiceState;
  stateLabel?: string;
  /** A short note under the type, such as the rate-limit wait of a running step. */
  note?: string;
}

export type StationFlowNode = Node<StationNodeData, 'dag'>;

/**
 * A station on the React Flow canvas: the station itself and the ports the catalog declares. The input
 * is on the left; the outputs are on the right, fanned out on the edge of the circle when there are
 * several, each named for assistive technology and the pointer («Salida Sí»).
 */
function StationNodeBase({ data, selected }: NodeProps<StationFlowNode>) {
  const entry = NODE_CATALOG[data.nodeType];
  const outputs = entry.handles;
  return (
    <>
      {entry.acceptsInput && (
        <Handle
          type="target"
          position={Position.Left}
          className="station-port"
          aria-label="Entrada"
          title="Entrada"
        />
      )}
      <Station
        type={data.nodeType}
        label={data.label}
        selected={selected}
        problems={data.errorCount}
        problemTitle={data.errorTitle}
        {...(data.state ? { state: data.state } : {})}
        {...(data.stateLabel ? { stateLabel: data.stateLabel } : {})}
        {...(data.note ? { note: data.note } : {})}
      />
      {outputs.map((handle, index) => {
        const name = outputs.length > 1 ? `Salida ${HANDLE_LABELS[handle] ?? handle}` : 'Salida';
        return (
          <Handle
            key={handle}
            id={handle}
            type="source"
            position={Position.Right}
            className={cn(
              'station-port',
              outputs.length > 1 && `station-port-of-${outputs.length} station-port-at-${index}`,
            )}
            aria-label={name}
            title={name}
          />
        );
      })}
    </>
  );
}

export const StationNode = memo(StationNodeBase);
