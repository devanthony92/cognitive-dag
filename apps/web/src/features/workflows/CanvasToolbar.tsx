import { Panel } from '@xyflow/react';
import { Cable, Plus, SlidersHorizontal } from 'lucide-react';
import { memo } from 'react';
import { Button } from '../../components/ui/button';

interface Props {
  phone: boolean;
  canWrite: boolean;
  connecting: boolean;
  hasSelection: boolean;
  onAdd: () => void;
  onConnect: () => void;
  onConfigure: () => void;
}

/**
 * The buttons over the canvas: add a node and configure on a phone, and the connect mode. Memoised
 * with stable callbacks so typing in the panel does not rebuild it.
 */
function CanvasToolbarBase({
  phone,
  canWrite,
  connecting,
  hasSelection,
  onAdd,
  onConnect,
  onConfigure,
}: Props) {
  return (
    <Panel position="top-left" className="flex flex-wrap gap-2">
      {phone && canWrite && (
        <Button variant="secondary" onClick={onAdd}>
          <Plus aria-hidden />
          Añadir nodo
        </Button>
      )}
      {canWrite && (
        <Button
          variant={connecting ? 'primary' : 'secondary'}
          aria-pressed={connecting}
          onClick={onConnect}
        >
          <Cable aria-hidden />
          Conectar
        </Button>
      )}
      {phone && (
        <Button variant="secondary" disabled={!hasSelection} onClick={onConfigure}>
          <SlidersHorizontal aria-hidden />
          Configurar
        </Button>
      )}
    </Panel>
  );
}

export const CanvasToolbar = memo(CanvasToolbarBase);
