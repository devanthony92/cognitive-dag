import { Handle, Position, type NodeProps } from '@xyflow/react';
import { TriangleAlert } from 'lucide-react';
import { memo } from 'react';
import { NODE_CATALOG } from '@cognitive-dag/dag-schema';
import { cn } from '../../lib/utils';
import { HANDLE_LABELS, type FlowNode } from './flow';

const CATEGORY_ACCENT: Record<string, string> = {
  trigger: 'border-l-emerald-500',
  llm: 'border-l-violet-500',
  logic: 'border-l-amber-500',
  human: 'border-l-sky-500',
  integration: 'border-l-rose-500',
  mock: 'border-l-slate-400',
};

/** A node of the canvas: label, type, an error badge, and the handles the catalog declares. */
function DagNodeViewBase({ data, selected }: NodeProps<FlowNode>) {
  const entry = NODE_CATALOG[data.nodeType];
  const outputs = entry.handles;
  const branching = outputs.length > 1;
  return (
    <div
      className={cn(
        'min-w-40 rounded-md border border-l-4 bg-card px-3 py-2 text-card-foreground shadow-xs',
        CATEGORY_ACCENT[entry.category],
        selected && 'ring-2 ring-ring',
        data.errorCount > 0 && 'border-destructive',
      )}
      style={branching ? { minHeight: 28 + outputs.length * 22 } : undefined}
    >
      {entry.acceptsInput && <Handle type="target" position={Position.Left} />}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{data.label}</p>
          <p className="truncate text-xs text-muted-foreground">{entry.label}</p>
        </div>
        {data.errorCount > 0 && (
          <span
            data-testid="node-errors"
            title={data.errorTitle}
            className="flex shrink-0 items-center gap-1 text-xs font-medium text-destructive"
          >
            <TriangleAlert className="size-3.5" aria-hidden />
            <span className="sr-only">Errores:</span>
            {data.errorCount}
          </span>
        )}
      </div>
      {outputs.map((handle, index) => (
        <Handle
          key={handle}
          id={handle}
          type="source"
          position={Position.Right}
          style={branching ? { top: `${((index + 1) / (outputs.length + 1)) * 100}%` } : undefined}
        >
          {branching && (
            <span className="pointer-events-none absolute right-3 -translate-y-1/2 text-[10px] text-muted-foreground">
              {HANDLE_LABELS[handle] ?? handle}
            </span>
          )}
        </Handle>
      ))}
    </div>
  );
}

export const DagNodeView = memo(DagNodeViewBase);
