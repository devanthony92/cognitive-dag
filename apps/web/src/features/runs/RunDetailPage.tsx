import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Ban, RotateCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { ApiProblemError } from '../../api/client';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { ProblemAlert } from '../auth/ProblemAlert';
import { featuresQuery, isResilienceEnabled } from '../flags';
import { workflowQuery } from '../workflows/api';
import { toEditableDefinition } from '../workflows/model';
import { cancelRun, rerunRun, runKey, runQuery, runsKey } from './api';
import { errorMessage } from './error-messages';
import { RunGraph } from './RunGraph';
import { StatusBadge } from './StatusBadge';
import { StepPanel } from './StepPanel';
import { formatDateTime, formatDuration, isFinalRun, runDurationMs } from './status';
import { useNow, useRunLive } from './useRunLive';

const MODE_TEXT = {
  connecting: 'Conectando…',
  live: 'En vivo',
  polling: 'Conexión en vivo interrumpida: se actualiza cada pocos segundos.',
  idle: '',
} as const;

/** Detail of one run: the graph of its version with live node states, and the node panel. */
export function RunDetailPage({
  organizationId,
  runId,
  initialNodeId,
}: {
  organizationId: string;
  runId: string;
  /** Node to open, e.g. coming from a reused node of a rerun. */
  initialNodeId?: string;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const run = useQuery(runQuery(organizationId, runId));
  // The run carries no workflow name: reuse the workflow query (the header degrades without it).
  const workflowId = run.data?.workflowId;
  const workflow = useQuery({
    ...workflowQuery(organizationId, workflowId ?? ''),
    enabled: workflowId !== undefined,
  });
  const final = run.data ? isFinalRun(run.data.status) : false;
  const active = run.isSuccess && !final;
  const mode = useRunLive(organizationId, runId, active);
  const now = useNow(active);

  const features = useQuery(featuresQuery);
  const resilience = isResilienceEnabled(features.data);
  const [selectedId, setSelectedId] = useState<string | undefined>(initialNodeId);
  const [cancelOpen, setCancelOpen] = useState(false);

  const definition = useMemo(
    () => (run.data ? toEditableDefinition(run.data.definition).definition : undefined),
    [run.data],
  );

  const cancel = useMutation({
    mutationFn: () => cancelRun(organizationId, runId),
    onSettled: async () => {
      setCancelOpen(false);
      // Whatever happened, the run is the source of truth: look at it again.
      await queryClient.invalidateQueries({ queryKey: runKey(organizationId, runId) });
    },
  });
  const rerun = useMutation({
    mutationFn: (fromNodeId?: string) => rerunRun(organizationId, runId, fromNodeId),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({
        queryKey: runsKey(organizationId, created.workflowId),
      });
      await navigate({
        to: '/orgs/$organizationId/runs/$runId',
        params: { organizationId, runId: created.id },
      });
    },
  });

  if (run.isError) {
    return (
      <div className="mx-auto grid w-full max-w-xl gap-3 p-6">
        <ProblemAlert error={run.error} />
        <div>
          <Button variant="outline" size="sm" onClick={() => void run.refetch()}>
            Reintentar
          </Button>
        </div>
      </div>
    );
  }
  if (!run.data || !definition) {
    return <p className="p-6 text-muted-foreground">Cargando la ejecución…</p>;
  }

  const data = run.data;
  const selectedStep = data.steps.find((step) => step.nodeId === selectedId);
  const labelOf = (nodeId: string) =>
    definition.nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
  const cancelError = cancel.error instanceof ApiProblemError ? cancel.error.problem : undefined;
  const rerunError = rerun.error instanceof ApiProblemError ? rerun.error.problem : undefined;

  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-[32rem] w-full flex-col bg-background">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-card px-4 py-2">
        <Link
          to="/orgs/$organizationId/workflows/$workflowId/runs"
          params={{ organizationId, workflowId: data.workflowId }}
          className="text-sm underline"
        >
          Ejecuciones
        </Link>
        <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight">
          {workflow.data ? (
            <>
              <Link
                to="/orgs/$organizationId/workflows/$workflowId"
                params={{ organizationId, workflowId: data.workflowId }}
                className="underline"
              >
                {workflow.data.name}
              </Link>
              <span className="font-normal text-muted-foreground"> · </span>
            </>
          ) : null}
          Ejecución
        </h1>
        <StatusBadge status={data.status} />
        <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <div className="flex gap-1">
            <dt>Versión</dt>
            <dd className="text-foreground">{data.versionNumber}</dd>
          </div>
          <div className="flex min-w-0 gap-1">
            <dt>Inició</dt>
            <dd className="max-w-40 truncate text-foreground" title={data.triggeredBy.name}>
              {data.triggeredBy.name}
            </dd>
          </div>
          <div className="flex gap-1">
            <dt>Creada</dt>
            <dd className="text-foreground">{formatDateTime(data.createdAt)}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Duración</dt>
            <dd className="text-foreground">{formatDuration(runDurationMs(data, now))}</dd>
          </div>
          {data.rerunOf && (
            <div>
              <Link
                to="/orgs/$organizationId/runs/$runId"
                params={{ organizationId, runId: data.rerunOf }}
                {...(resilience && data.rerunFromNodeId
                  ? { search: { node: data.rerunFromNodeId } }
                  : {})}
                className="underline"
              >
                {resilience && data.rerunFromNodeId
                  ? `Reejecución desde «${labelOf(data.rerunFromNodeId)}» de otra ejecución`
                  : 'Reejecución de otra ejecución'}
              </Link>
            </div>
          )}
        </dl>
        <div className="ml-auto flex items-center gap-3">
          {active && (
            <span role="status" className="text-xs text-muted-foreground">
              {MODE_TEXT[mode]}
            </span>
          )}
          {!final && (
            <Button
              variant="outline"
              disabled={cancel.isPending}
              onClick={() => {
                cancel.reset();
                setCancelOpen(true);
              }}
            >
              <Ban aria-hidden />
              Cancelar
            </Button>
          )}
          {final && (
            <Button
              variant="outline"
              disabled={rerun.isPending}
              onClick={() => rerun.mutate(undefined)}
            >
              <RotateCw aria-hidden />
              {rerun.isPending ? 'Reejecutando…' : 'Reejecutar'}
            </Button>
          )}
        </div>
      </div>

      {(data.error || rerun.isError || (cancelError && !cancelOpen)) && (
        <div className="grid gap-2 px-4 py-2" role="status">
          {data.error && (
            <Alert variant="destructive">
              <AlertDescription>
                <p className="font-medium">La ejecución terminó con un error.</p>
                <p>{errorMessage(data.error)}</p>
                <p className="mt-1 font-mono text-xs">{data.error.code}</p>
              </AlertDescription>
            </Alert>
          )}
          {rerunError?.code === 'RUN_INPUT_EXPIRED' ? (
            <Alert variant="destructive">
              <AlertDescription>
                No se puede reejecutar: la entrada de esta ejecución ya no se conserva. Inicia una
                ejecución nueva desde el workflow.
              </AlertDescription>
            </Alert>
          ) : (
            rerun.isError && <ProblemAlert error={rerun.error} />
          )}
          {cancelError && !cancelOpen && cancelError.code !== 'RUN_NOT_CANCELLABLE' && (
            <ProblemAlert error={cancel.error} />
          )}
          {cancelError?.code === 'RUN_NOT_CANCELLABLE' && !cancelOpen && (
            <Alert>
              <AlertDescription>
                La ejecución ya había terminado y no se pudo cancelar.
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <ReactFlowProvider>
            <RunGraph
              definition={definition}
              steps={data.steps}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </ReactFlowProvider>
        </div>
        <aside
          aria-label="Detalle del nodo"
          className="w-80 shrink-0 overflow-y-auto border-l bg-card p-4"
        >
          {selectedStep ? (
            <StepPanel
              key={selectedStep.nodeId}
              organizationId={organizationId}
              runId={runId}
              step={selectedStep}
              label={labelOf(selectedStep.nodeId)}
              now={now}
              resilience={resilience}
              rerunOf={data.rerunOf}
              {...(resilience && final
                ? {
                    onRerunFrom: () => rerun.mutate(selectedStep.nodeId),
                    rerunning: rerun.isPending,
                  }
                : {})}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Selecciona un nodo del grafo para ver sus intentos, duración, error, entrada y salida.
            </p>
          )}
        </aside>
      </div>

      <Dialog open={cancelOpen} onOpenChange={(next) => !cancel.isPending && setCancelOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Cancelar la ejecución?</DialogTitle>
            <DialogDescription>
              Los nodos en curso se cancelan y los pendientes no se ejecutan. No se puede deshacer;
              puedes reejecutarla después.
            </DialogDescription>
          </DialogHeader>
          {cancel.isError && cancelError?.code !== 'RUN_NOT_CANCELLABLE' && (
            <ProblemAlert error={cancel.error} />
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={cancel.isPending}
              onClick={() => setCancelOpen(false)}
            >
              Seguir ejecutando
            </Button>
            <Button
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              {cancel.isPending ? 'Cancelando…' : 'Cancelar ejecución'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
