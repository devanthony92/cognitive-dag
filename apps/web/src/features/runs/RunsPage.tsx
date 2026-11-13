import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { PageHeader } from '../../components/ui/page-header';
import { RowsSkeleton } from '../../components/ui/rows-skeleton';
import { ProblemAlert } from '../auth/ProblemAlert';
import { workflowQuery } from '../workflows/api';
import { runsQuery } from './api';
import { RunButton } from './RunButton';
import { RunsTable } from './RunsTable';
import { isFinalRun } from './status';
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
    <div className="grid w-full gap-6">
      <div className="grid gap-2">
        <Link
          to="/orgs/$organizationId/workflows/$workflowId"
          params={{ organizationId, workflowId }}
          className="inline-flex min-h-11 items-center gap-1 text-body-sm text-ink-muted underline underline-offset-4 hover:text-ink"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Volver al workflow
        </Link>
        <PageHeader
          title="Ejecuciones"
          description={workflow.data ? workflow.data.name : 'Historial del workflow'}
          action={
            <RunButton
              organizationId={organizationId}
              workflowId={workflowId}
              workflowName={workflow.data?.name ?? 'Workflow'}
            />
          }
        />
      </div>

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
          title="Este workflow todavía no se ha ejecutado."
          description="Usa «Ejecutar» para lanzar la versión activa."
          action={
            <Button asChild variant="secondary">
              <Link
                to="/orgs/$organizationId/workflows/$workflowId"
                params={{ organizationId, workflowId }}
              >
                Abrir el workflow
              </Link>
            </Button>
          }
        />
      )}
      {items.length > 0 && <RunsTable runs={items} organizationId={organizationId} now={now} />}
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
