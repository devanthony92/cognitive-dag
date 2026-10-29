import { useMutation, useQuery } from '@tanstack/react-query';
import {
  FEATURE_FLAGS,
  IDEMPOTENCY_KEY_HEADER,
  PingExecutionSchema,
  PublicFeaturesSchema,
  TERMINAL_PING_STATUSES,
  type PingExecution,
} from '@cognitive-dag/contracts';
import { ApiProblemError, request } from '../../api/client';

const STATUS_LABELS: Record<PingExecution['status'], string> = {
  pending: 'Pendiente',
  running: 'En ejecución',
  completed: 'Completado',
  failed: 'Fallido',
  timed_out: 'Tiempo agotado',
};

const POLL_INTERVAL_MS = 1_000;

function isTerminal(ping: PingExecution | undefined): boolean {
  return ping !== undefined && TERMINAL_PING_STATUSES.includes(ping.status);
}

/** Starts a ping and follows it until a terminal status. Hidden while the feature flag is off. */
export function PingPanel() {
  const features = useQuery({
    queryKey: ['features'],
    queryFn: async () => (await request('/api/v1/features', PublicFeaturesSchema)).data,
  });

  const start = useMutation({
    mutationFn: async () =>
      (
        await request('/api/v1/pings', PingExecutionSchema, {
          method: 'POST',
          headers: { [IDEMPOTENCY_KEY_HEADER]: crypto.randomUUID() },
          body: JSON.stringify({}),
        })
      ).data,
  });

  const pingId = start.data?.pingId;
  const status = useQuery({
    queryKey: ['ping', pingId],
    enabled: pingId !== undefined,
    initialData: start.data,
    queryFn: async () => (await request(`/api/v1/pings/${pingId}`, PingExecutionSchema)).data,
    refetchInterval: (query) => (isTerminal(query.state.data) ? false : POLL_INTERVAL_MS),
  });

  if (!features.data?.[FEATURE_FLAGS.pingEnabled]) return null;

  const ping = status.data ?? start.data;
  const error = start.error ?? status.error;

  return (
    <section aria-labelledby="ping-title">
      <h2 id="ping-title">Ping de extremo a extremo</h2>
      <button type="button" onClick={() => start.mutate()} disabled={start.isPending}>
        Ejecutar ping
      </button>
      {error && (
        <p role="alert">
          {error instanceof ApiProblemError
            ? error.problem.detail
            : 'No se pudo completar la solicitud.'}
          {error instanceof ApiProblemError && (
            <small> (correlationId: {error.problem.correlationId})</small>
          )}
        </p>
      )}
      {ping && (
        <dl>
          <dt>Estado</dt>
          <dd>{STATUS_LABELS[ping.status]}</dd>
          {ping.result && (
            <>
              <dt>Resultado</dt>
              <dd>
                {ping.result.pong} (worker {ping.result.workerId}, intentos {ping.result.attempts})
              </dd>
            </>
          )}
          <dt>correlationId</dt>
          <dd>
            <code>{ping.correlationId}</code>
          </dd>
        </dl>
      )}
    </section>
  );
}
