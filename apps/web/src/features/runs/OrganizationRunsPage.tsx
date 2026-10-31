import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { RotateCw } from 'lucide-react';
import { useState } from 'react';
import { RunStatusSchema, type OrganizationRun } from '@cognitive-dag/contracts';
import { ApiProblemError } from '../../api/client';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Label } from '../../components/ui/label';
import { NativeSelect } from '../../components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { ProblemAlert } from '../auth/ProblemAlert';
import { workflowsQuery } from '../workflows/api';
import { organizationRunsQuery, rerunRun, type OrganizationRunFilters } from './api';
import { StatusBadge } from './StatusBadge';
import {
  ERROR_CLASS_LABELS,
  RUN_STATUS_LABELS,
  formatDateTime,
  formatDuration,
  isFinalRun,
  runDurationMs,
} from './status';
import { useNow } from './useRunLive';

interface Props {
  organizationId: string;
  filters: OrganizationRunFilters;
  onFiltersChange: (filters: OrganizationRunFilters) => void;
}

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
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8">
      <section className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">Ejecuciones</h1>
        <p className="text-muted-foreground">
          Todas las ejecuciones de la organización, de la más reciente a la más antigua.
        </p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
          <CardDescription>Encuentra lo que falló y reejecútalo sin salir de aquí.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="grid min-w-44 flex-1 gap-1.5">
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
                  {status === 'failed' ? 'Fallidas' : RUN_STATUS_LABELS[status]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid min-w-44 flex-1 gap-1.5">
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
              variant="outline"
              onClick={() => onFiltersChange({ status: undefined, workflowId: undefined })}
            >
              Limpiar filtros
            </Button>
          )}
        </CardContent>
      </Card>

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

      <Card>
        <CardHeader>
          <CardTitle>Historial</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {runs.isPending && <p className="text-sm text-muted-foreground">Cargando ejecuciones…</p>}
          {runs.isError && (
            <div className="grid gap-2">
              <ProblemAlert error={runs.error} />
              <div>
                <Button variant="outline" size="sm" onClick={() => void runs.refetch()}>
                  Reintentar
                </Button>
              </div>
            </div>
          )}
          {runs.isSuccess && items.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {filtered
                ? 'Ninguna ejecución coincide con los filtros.'
                : 'La organización todavía no tiene ejecuciones. Lanza un workflow desde su editor.'}
            </p>
          )}
          {items.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Workflow</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Falló en</TableHead>
                    <TableHead>Creada</TableHead>
                    <TableHead>Duración</TableHead>
                    <TableHead>Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((run) => (
                    <RunRow
                      key={run.id}
                      run={run}
                      organizationId={organizationId}
                      now={now}
                      busy={rerun.isPending}
                      target={target?.runId === run.id ? target : undefined}
                      onRerun={(fromNodeId) =>
                        rerun.mutate({ runId: run.id, ...(fromNodeId ? { fromNodeId } : {}) })
                      }
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {runs.hasNextPage && (
            <div>
              <Button
                variant="outline"
                disabled={runs.isFetchingNextPage}
                onClick={() => void runs.fetchNextPage()}
              >
                {runs.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RunRow({
  run,
  organizationId,
  now,
  busy,
  target,
  onRerun,
}: {
  run: OrganizationRun;
  organizationId: string;
  now: number;
  busy: boolean;
  target: Target | undefined;
  onRerun: (fromNodeId?: string) => void;
}) {
  const final = isFinalRun(run.status);
  const errorClass = run.error?.class ? ERROR_CLASS_LABELS[run.error.class] : undefined;
  return (
    <TableRow>
      <TableCell className="max-w-48 truncate" title={run.workflowName}>
        <Link
          to="/orgs/$organizationId/workflows/$workflowId/runs"
          params={{ organizationId, workflowId: run.workflowId }}
          className="underline"
        >
          {run.workflowName}
        </Link>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={run.status} />
          {errorClass && (
            <span
              title={errorClass.hint}
              className="rounded-full border border-red-300 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-red-900"
            >
              {errorClass.label}
            </span>
          )}
        </div>
        {run.rerunOf && (
          <p className="mt-1 text-xs text-muted-foreground">
            Reejecución{run.rerunFromNodeId ? ` desde ${run.rerunFromNodeId}` : ''}
          </p>
        )}
      </TableCell>
      <TableCell className="font-mono text-xs">{run.failedNodeId ?? '—'}</TableCell>
      <TableCell className="whitespace-nowrap">{formatDateTime(run.createdAt)}</TableCell>
      <TableCell className="whitespace-nowrap">{formatDuration(runDurationMs(run, now))}</TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/orgs/$organizationId/runs/$runId"
            params={{ organizationId, runId: run.id }}
            className="text-sm underline"
          >
            Ver detalle
          </Link>
          {final && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => onRerun()}>
              <RotateCw aria-hidden />
              {target && target.fromNodeId === undefined ? 'Reejecutando…' : 'Reejecutar'}
            </Button>
          )}
          {final && run.failedNodeId !== null && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onRerun(run.failedNodeId ?? undefined)}
            >
              <RotateCw aria-hidden />
              {target?.fromNodeId !== undefined
                ? 'Reejecutando…'
                : 'Reejecutar desde el nodo fallido'}
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
