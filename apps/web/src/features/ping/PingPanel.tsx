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
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';

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

/**
 * Starts a ping and follows it until a terminal status. Hidden while the feature flag is off.
 * Inside an organization (identity on) the ping is scoped to it; otherwise it is the F0 route.
 */
export function PingPanel({ organizationId }: { organizationId?: string } = {}) {
  const basePath =
    organizationId === undefined
      ? '/api/v1/pings'
      : `/api/v1/organizations/${organizationId}/pings`;
  const features = useQuery({
    queryKey: ['features'],
    queryFn: async () => (await request('/api/v1/features', PublicFeaturesSchema)).data,
  });

  const start = useMutation({
    mutationFn: async () =>
      (
        await request(basePath, PingExecutionSchema, {
          method: 'POST',
          headers: { [IDEMPOTENCY_KEY_HEADER]: crypto.randomUUID() },
          body: JSON.stringify({}),
        })
      ).data,
  });

  const pingId = start.data?.pingId;
  const status = useQuery({
    queryKey: ['ping', organizationId, pingId],
    enabled: pingId !== undefined,
    initialData: start.data,
    queryFn: async () => (await request(`${basePath}/${pingId}`, PingExecutionSchema)).data,
    refetchInterval: (query) => (isTerminal(query.state.data) ? false : POLL_INTERVAL_MS),
  });

  if (!features.data?.[FEATURE_FLAGS.pingEnabled]) return null;

  const ping = status.data ?? start.data;
  const error = start.error ?? status.error;

  return (
    <Card aria-labelledby="ping-title" role="region">
      <CardHeader>
        <CardTitle id="ping-title">Ping de extremo a extremo</CardTitle>
        <CardDescription>
          Ejecuta un workflow de prueba y sigue su estado hasta que termine.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div>
          <Button type="button" onClick={() => start.mutate()} disabled={start.isPending}>
            Ejecutar ping
          </Button>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              <p>
                {error instanceof ApiProblemError
                  ? error.problem.detail
                  : 'No se pudo completar la solicitud.'}
              </p>
              {error instanceof ApiProblemError && (
                <p className="mt-1 text-xs text-muted-foreground">
                  correlationId: {error.problem.correlationId}
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}
        {ping && (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Estado</dt>
            <dd>
              <Badge status={ping.status} />
            </dd>
            {ping.result && (
              <>
                <dt className="text-muted-foreground">Resultado</dt>
                <dd>
                  {ping.result.pong} (worker {ping.result.workerId}, intentos {ping.result.attempts}
                  )
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">correlationId</dt>
            <dd>
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{ping.correlationId}</code>
            </dd>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

/** The status as a pill; the label stays plain text so it reads the same to assistive tech. */
function Badge({ status }: { status: PingExecution['status'] }) {
  const tone =
    status === 'completed'
      ? 'bg-primary text-primary-foreground'
      : status === 'failed' || status === 'timed_out'
        ? 'bg-destructive/10 text-destructive'
        : 'bg-muted text-muted-foreground';
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
