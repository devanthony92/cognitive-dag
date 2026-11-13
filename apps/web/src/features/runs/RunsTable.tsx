import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { Run } from '@cognitive-dag/contracts';
import { LazyServiceStrip } from '../../components/station/ServiceStrip';
import { useRecentChange } from '../../components/station/useRecentChange';
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
import { formatDateTime, formatDuration, isFinalRun, originOf, runDurationMs } from './status';

/** A run of the list. The organization-wide list also knows the workflow and the node that failed. */
export type RunsTableRow = Run & { workflowName?: string; failedNodeId?: string | null };

interface Props<T extends RunsTableRow> {
  runs: T[];
  organizationId: string;
  /** Clock for runs still counting; see `useNow`. */
  now: number;
  /** Adds the Workflow column (the list of the whole organization). */
  showWorkflow?: boolean;
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
  renderActions,
}: Props<T>) {
  return (
    <Table>
      <TableHeader className={STACKED.head}>
        <TableRow>
          <TableHead>Estado</TableHead>
          {showWorkflow && <TableHead>Workflow</TableHead>}
          {!showWorkflow && <TableHead>Versión</TableHead>}
          {!showWorkflow && <TableHead>Inició</TableHead>}
          <TableHead>Creada</TableHead>
          <TableHead>Pasos</TableHead>
          <TableHead numeric>Duración</TableHead>
          <TableHead>
            <span className="sr-only">Acciones</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <RunRow
            key={run.id}
            run={run}
            organizationId={organizationId}
            now={now}
            showWorkflow={showWorkflow}
            {...(renderActions ? { renderActions } : {})}
          />
        ))}
      </TableBody>
    </Table>
  );
}

/** A row: highlighted for 8 s when its state changes, until it receives the focus. */
function RunRow<T extends RunsTableRow>({
  run,
  organizationId,
  now,
  showWorkflow,
  renderActions,
}: {
  run: T;
  organizationId: string;
  now: number;
  showWorkflow: boolean;
  renderActions?: (run: T) => ReactNode;
}) {
  const recent = useRecentChange(run.status);
  return (
    <TableRow
      data-highlighted={recent.changed ? '' : undefined}
      onFocus={recent.onFocus}
      className={cn(STACKED.row, recent.className)}
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
      {!showWorkflow && (
        <>
          <TableCell className={cn(STACKED.cell, 'tabular-nums')}>
            <span className="sm:hidden text-ink-muted">Versión </span>
            {run.versionNumber}
          </TableCell>
          <TableCell className={cn(STACKED.cell, 'max-w-40 truncate')} title={originOf(run)}>
            {originOf(run)}
          </TableCell>
        </>
      )}
      <TableCell className={cn(STACKED.cell, 'tabular-nums')}>
        {formatDateTime(run.createdAt)}
      </TableCell>
      <TableCell className={STACKED.cell}>
        <LazyServiceStrip
          organizationId={organizationId}
          runId={run.id}
          final={isFinalRun(run.status)}
        />
      </TableCell>
      <TableCell numeric className={cn(STACKED.cell, 'max-sm:text-left')}>
        {formatDuration(runDurationMs(run, now))}
      </TableCell>
      <TableCell className={STACKED.cell}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
  );
}
