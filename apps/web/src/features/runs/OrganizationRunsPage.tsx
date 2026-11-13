import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { RotateCw } from 'lucide-react';
import { useState } from 'react';
import { RunStatusSchema, type OrganizationRun, type RunStatus } from '@cognitive-dag/contracts';
import { ApiProblemError } from '../../api/client';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { PageHeader } from '../../components/ui/page-header';
import { RowsSkeleton } from '../../components/ui/rows-skeleton';
import { Label } from '../../components/ui/label';
import { NativeSelect } from '../../components/ui/native-select';
import { ProblemAlert } from '../auth/ProblemAlert';
import { workflowsQuery } from '../workflows/api';
import { organizationRunsQuery, rerunRun, type OrganizationRunFilters } from './api';
import { RunsTable } from './RunsTable';
import { isFinalRun } from './status';
import { useNow } from './useRunLive';
import { useRunPermission } from './permissions';

/** Plural, because each option is a group of runs. */
const STATUS_FILTER_LABELS: Record<RunStatus, string> = {
  queued: 'En cola',
  running: 'En curso',
  succeeded: 'Completadas',
  failed: 'Fallidas',
  cancelled: 'Canceladas',
  timed_out: 'Vencidas',
};

interface Props {
  organizationId: string;
  filters: OrganizationRunFilters;
  onFiltersChange: (filters: OrganizationRunFilters) => void;
}

/** Id of the sentence that says why the rerun buttons are disabled. */
const REASON_ID = 'org-runs-role-reason';

/** What the person is rerunning right now, to mark only that row. */
interface Target {
  runId: string;
  fromNodeId?: string;
}

/** Review queue of the organization: every run, filterable, with the way back from a failure. */
export function OrganizationRunsPage({ organizationId, filters, onFiltersChange }: Props) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const workflows = useQuery(workflowsQuery(organizationId));
  const { canExecute, blockedReason } = useRunPermission(organizationId);
  const runs = useInfiniteQuery({
    ...organizationRunsQuery(organizationId, filters),
    // Runs in progress change under the list: look again while there is one.
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) => page.items.some((run) => !isFinalRun(run.status)))
        ? 3000
        : false,
  });
  const items = runs.data?.pages.flatMap((page) => page.items) ?? [];
  const now = useNow(items.some((run) => run.finishedAt === null));
  const filtered = filters.status !== undefined || filters.workflowId !== undefined;

  const [target, setTarget] = useState<Target>();
  const rerun = useMutation({
    mutationFn: (next: Target) => rerunRun(organizationId, next.runId, next.fromNodeId),
    onMutate: (next) => setTarget(next),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ['organization-runs', organizationId] });
      await navigate({
        to: '/orgs/$organizationId/runs/$runId',
        params: { organizationId, runId: created.id },
      });
    },
    onSettled: () => setTarget(undefined),
  });
  const rerunProblem = rerun.error instanceof ApiProblemError ? rerun.error.problem : undefined;

  return (
    <div className="grid w-full gap-6">
      <PageHeader
        title="Ejecuciones"
        description="Todas las ejecuciones de la organización, de la más reciente a la más antigua."
      />

      <section aria-label="Filtros" className="flex flex-wrap items-end gap-4">
        <div className="grid min-w-44 flex-1 gap-2">
          <Label htmlFor="runs-status">Estado</Label>
          <NativeSelect
            id="runs-status"
            value={filters.status ?? ''}
            onChange={(event) => {
              const parsed = RunStatusSchema.safeParse(event.target.value);
              onFiltersChange({ ...filters, status: parsed.success ? parsed.data : undefined });
            }}
          >
            <option value="">Todos</option>
            {RunStatusSchema.options.map((status) => (
              <option key={status} value={status}>
                {STATUS_FILTER_LABELS[status]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid min-w-44 flex-1 gap-2">
          <Label htmlFor="runs-workflow">Workflow</Label>
          <NativeSelect
            id="runs-workflow"
            value={filters.workflowId ?? ''}
            onChange={(event) =>
              onFiltersChange({ ...filters, workflowId: event.target.value || undefined })
            }
          >
            <option value="">Todos</option>
            {workflows.data?.map((workflow) => (
              <option key={workflow.id} value={workflow.id}>
                {workflow.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        {filtered && (
          <Button
            variant="secondary"
            onClick={() => onFiltersChange({ status: undefined, workflowId: undefined })}
          >
            Limpiar filtros
          </Button>
        )}
      </section>

      {rerunProblem?.code === 'RUN_INPUT_EXPIRED' ? (
        <Alert variant="destructive">
          <AlertDescription>
            No se puede reejecutar: la entrada de esta ejecución ya no se conserva. Inicia una
            ejecución nueva desde el workflow.
          </AlertDescription>
        </Alert>
      ) : (
        rerun.isError && <ProblemAlert error={rerun.error} />
      )}

      {runs.isPending && <RowsSkeleton rows={5} />}
      {runs.isError && (
        <div className="grid justify-items-start gap-3">
          <ProblemAlert error={runs.error} />
          <Button variant="secondary" onClick={() => void runs.refetch()}>
            Reintentar
          </Button>
        </div>
      )}
      {runs.isSuccess && items.length === 0 && (
        <EmptyState
          title={
            filtered
              ? 'Ninguna ejecución coincide con los filtros.'
              : 'La organización todavía no tiene ejecuciones. Lanza un workflow desde su editor.'
          }
          action={
            filtered ? (
              <Button
                variant="secondary"
                onClick={() => onFiltersChange({ status: undefined, workflowId: undefined })}
              >
                Limpiar filtros
              </Button>
            ) : (
              <Button asChild variant="secondary">
                <Link to="/orgs/$organizationId/workflows" params={{ organizationId }}>
                  Ir a Workflows
                </Link>
              </Button>
            )
          }
        />
      )}
      {items.length > 0 && blockedReason && (
        <p id={REASON_ID} className="text-body-sm text-ink-muted">
          {blockedReason}
        </p>
      )}
      {items.length > 0 && (
        <RunsTable
          runs={items}
          organizationId={organizationId}
          now={now}
          showWorkflow
          renderActions={(run) => (
            <RerunActions
              run={run}
              busy={rerun.isPending || !canExecute}
              {...(blockedReason ? { blockedBy: REASON_ID } : {})}
              target={target?.runId === run.id ? target : undefined}
              onRerun={(fromNodeId) =>
                rerun.mutate({ runId: run.id, ...(fromNodeId ? { fromNodeId } : {}) })
              }
            />
          )}
        />
      )}
      {runs.hasNextPage && (
        <div>
          <Button
            variant="secondary"
            disabled={runs.isFetchingNextPage}
            onClick={() => void runs.fetchNextPage()}
          >
            {runs.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
          </Button>
        </div>
      )}
    </div>
  );
}

function RerunActions({
  run,
  busy,
  blockedBy,
  target,
  onRerun,
}: {
  run: OrganizationRun;
  busy: boolean;
  /** Id of the sentence that says the role does not allow rerunning (ADR-0082). */
  blockedBy?: string;
  target: Target | undefined;
  onRerun: (fromNodeId?: string) => void;
}) {
  if (!isFinalRun(run.status)) return null;
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        className="h-auto min-h-11 py-1.5 text-left whitespace-normal"
        disabled={busy}
        aria-describedby={blockedBy}
        onClick={() => onRerun()}
      >
        <RotateCw aria-hidden />
        {target && target.fromNodeId === undefined ? 'Reejecutando…' : 'Reejecutar'}
      </Button>
      {run.failedNodeId !== null && (
        <Button
          variant="secondary"
          size="sm"
          className="h-auto min-h-11 py-1.5 text-left whitespace-normal"
          disabled={busy}
          aria-describedby={blockedBy}
          onClick={() => onRerun(run.failedNodeId ?? undefined)}
        >
          <RotateCw aria-hidden />
          {target?.fromNodeId !== undefined ? 'Reejecutando…' : 'Reejecutar desde el nodo fallido'}
        </Button>
      )}
    </>
  );
}
