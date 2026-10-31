import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { ProblemAlert } from '../auth/ProblemAlert';
import { workflowQuery } from '../workflows/api';
import { runsQuery } from './api';
import { RunButton } from './RunButton';
import { StatusBadge } from './StatusBadge';
import { formatDateTime, formatDuration, isFinalRun, runDurationMs } from './status';
import { useNow } from './useRunLive';

/** Runs of one workflow, newest first, paged with a cursor. */
export function RunsPage({
  organizationId,
  workflowId,
}: {
  organizationId: string;
  workflowId: string;
}) {
  const workflow = useQuery(workflowQuery(organizationId, workflowId));
  const runs = useInfiniteQuery({
    ...runsQuery(organizationId, workflowId),
    // Runs in progress change under the list: look again while there is one.
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) => page.items.some((run) => !isFinalRun(run.status)))
        ? 3000
        : false,
  });
  const items = runs.data?.pages.flatMap((page) => page.items) ?? [];
  const counting = items.some((run) => run.finishedAt === null);
  const now = useNow(counting);

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-8">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            to="/orgs/$organizationId/workflows/$workflowId"
            params={{ organizationId, workflowId }}
            className="text-sm underline"
          >
            ← Volver al workflow
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Ejecuciones</h1>
          <p className="truncate text-muted-foreground">
            {workflow.data ? workflow.data.name : 'Historial del workflow'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <RunButton
            organizationId={organizationId}
            workflowId={workflowId}
            workflowName={workflow.data?.name ?? 'Workflow'}
          />
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Historial</CardTitle>
          <CardDescription>De la más reciente a la más antigua.</CardDescription>
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
              Este workflow todavía no se ha ejecutado. Usa «Ejecutar» para lanzar la versión
              activa.
            </p>
          )}
          {items.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Estado</TableHead>
                    <TableHead>Versión</TableHead>
                    <TableHead>Inició</TableHead>
                    <TableHead>Creada</TableHead>
                    <TableHead>Duración</TableHead>
                    <TableHead>
                      <span className="sr-only">Detalle</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell>
                        <StatusBadge status={run.status} />
                        {run.rerunOf && (
                          <span className="ml-2 text-xs text-muted-foreground">Reejecución</span>
                        )}
                      </TableCell>
                      <TableCell>{run.versionNumber}</TableCell>
                      <TableCell className="max-w-40 truncate" title={run.triggeredBy.name}>
                        {run.triggeredBy.name}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDateTime(run.createdAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDuration(runDurationMs(run, now))}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          to="/orgs/$organizationId/runs/$runId"
                          params={{ organizationId, runId: run.id }}
                          className="text-sm underline"
                        >
                          Ver detalle
                        </Link>
                      </TableCell>
                    </TableRow>
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
