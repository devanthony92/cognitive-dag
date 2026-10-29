import { ApiProblemError } from '../../api/client';
import { Alert, AlertDescription } from '../../components/ui/alert';

/** "30 segundos", "1 minuto", "2 minutos". */
export function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} ${seconds === 1 ? 'segundo' : 'segundos'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
}

/** Shows the API problem (detail, wait for rate limits, correlation id) or a generic failure. */
export function ProblemAlert({ error }: { error: unknown }) {
  if (error instanceof ApiProblemError) {
    const { detail, retryAfterSeconds, correlationId } = error.problem;
    return (
      <Alert variant="destructive">
        <AlertDescription>
          <p>{detail}</p>
          {retryAfterSeconds !== undefined && (
            <p>Vuelve a intentarlo en {formatWait(retryAfterSeconds)}.</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">correlationId: {correlationId}</p>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive">
      <AlertDescription>No se pudo completar la solicitud. Inténtalo de nuevo.</AlertDescription>
    </Alert>
  );
}
