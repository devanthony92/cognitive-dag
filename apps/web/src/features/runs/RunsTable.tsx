import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { Run } from '@cognitive-dag/contracts';
import { StatusBadge } from '../../components/status/StatusBadge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { STACKED } from '../../components/ui/table-stacked';
import { cn } from '../../lib/utils';
import { formatDateTime, formatDuration, originOf, runDurationMs } from './status';

/** A run of the list. The organization-wide list also knows the workflow and the node that failed. */
export type RunsTableRow = Run & { workflowName?: string; failedNodeId?: string | null };

interface Props<T extends RunsTableRow> {
  runs: T[];
  organizationId: string;
  /** Clock for runs still counting; see `useNow`. */
  now: number;
  /** Adds the Workflow column (the list of the whole organization). */
  showWorkflow?: boolean;
  /**
   * The «tira de servicio»: one station per step of the run. When it is given the table gains a
   * «Pasos» column and renders it here; without it the column does not exist. PR 4 connects it.
   */
  renderSteps?: (run: T) => ReactNode;
  /** Whether the row changed state lately and stays on `raised` (the 8 s highlight of PR 4). */
  isHighlighted?: (run: T) => boolean;
  /** Extra actions of a row, after «Ver detalle» (the rerun buttons of the organization list). */
  renderActions?: (run: T) => ReactNode;
}

/**
 * The table of runs of both lists: state first (badge with glyph and label), then what makes the run
 * recognisable, tabular duration, and the way into its detail. Under 640 px each row stacks.
 */
export function RunsTable<T extends RunsTableRow>({
  runs,
  organizationId,
  now,
  showWorkflow = false,
  renderSteps,
  isHighlighted,
  renderActions,
}: Props<T>) {
  return (
    <Table>
      <TableHeader className={STACKED.head}>
        <TableRow>
          <TableHead>Estado</TableHead>
          {showWorkflow && <TableHead>Workflow</TableHead>}
          <TableHead>Versión</TableHead>
          <TableHead>Inició</TableHead>
          <TableHead>Creada</TableHead>
          {renderSteps && <TableHead>Pasos</TableHead>}
          <TableHead numeric>Duración</TableHead>
          <TableHead>
            <span className="sr-only">Acciones</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <TableRow
            key={run.id}
            data-highlighted={isHighlighted?.(run) ? '' : undefined}
            className={cn(STACKED.row, isHighlighted?.(run) && 'bg-raised')}
          >
            <TableCell className={STACKED.cell}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <StatusBadge status={run.status} errorClass={run.error?.class} />
                {run.rerunOf && (
                  <span className="text-body-sm text-ink-muted">
                    Reejecución{run.rerunFromNodeId ? ` desde ${run.rerunFromNodeId}` : ''}
                  </span>
                )}
              </div>
              {run.failedNodeId && (
                <p className="mt-1 text-body-sm text-ink-muted">
                  Falló en <span className="font-mono">{run.failedNodeId}</span>
                </p>
              )}
            </TableCell>
            {showWorkflow && (
              <TableCell className={cn(STACKED.cell, 'max-w-56 truncate')} title={run.workflowName}>
                <Link
                  to="/orgs/$organizationId/workflows/$workflowId/runs"
                  params={{ organizationId, workflowId: run.workflowId }}
                  className="inline-flex min-h-11 items-center underline underline-offset-4"
                >
                  {run.workflowName}
                </Link>
              </TableCell>
            )}
            <TableCell className={cn(STACKED.cell, 'tabular-nums')}>
              <span className="sm:hidden text-ink-muted">Versión </span>
              {run.versionNumber}
            </TableCell>
            <TableCell className={cn(STACKED.cell, 'max-w-40 truncate')} title={originOf(run)}>
              {originOf(run)}
            </TableCell>
            <TableCell className={cn(STACKED.cell, 'tabular-nums')}>
              {formatDateTime(run.createdAt)}
            </TableCell>
            {renderSteps && <TableCell className={STACKED.cell}>{renderSteps(run)}</TableCell>}
            <TableCell numeric className={cn(STACKED.cell, 'max-sm:text-left')}>
              {formatDuration(runDurationMs(run, now))}
            </TableCell>
            <TableCell className={STACKED.cell}>
              <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-start">
                <Link
                  to="/orgs/$organizationId/runs/$runId"
                  params={{ organizationId, runId: run.id }}
                  className="inline-flex min-h-11 items-center underline underline-offset-4"
                >
                  Ver detalle
                </Link>
                {renderActions?.(run)}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
