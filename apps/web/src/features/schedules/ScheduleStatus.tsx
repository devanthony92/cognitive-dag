import { useQuery } from '@tanstack/react-query';
import type { Schedule } from '@cognitive-dag/contracts';
import { ProblemAlert } from '../auth/ProblemAlert';
import { formatDateTime } from '../runs/status';
import { scheduleQuery } from './api';

const SYNC_TEXT: Record<Schedule['syncStatus'], string> = {
  pending: 'Pendiente: el motor la aplicará en menos de un minuto.',
  synced: 'Sincronizada con el motor.',
  failed: 'No se pudo aplicar en el motor; se reintenta sola.',
};

/**
 * What the programming of a workflow stands at (F7, US3): read only, because activating or
 * deactivating a version is what creates, changes and removes it.
 */
export function ScheduleStatus({
  organizationId,
  workflowId,
}: {
  organizationId: string;
  workflowId: string;
}) {
  const schedule = useQuery({
    ...scheduleQuery(organizationId, workflowId),
    // While it waits for the engine, look again for the moment it is applied.
    refetchInterval: (query) => (query.state.data?.syncStatus === 'synced' ? false : 15_000),
  });
  const state = schedule.data;
  return (
    <section aria-label="Programación" className="mt-6 grid gap-2 border-t pt-4">
      <h3 className="text-sm font-semibold">Programación</h3>
      {schedule.isPending && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {schedule.isError && <ProblemAlert error={schedule.error} />}
      {schedule.isSuccess && state === null && (
        <p className="text-sm text-muted-foreground">
          Se programa al activar una versión que tenga este disparador.
        </p>
      )}
      {state && (
        <>
          <dl className="grid gap-1 text-sm">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Activa</dt>
              <dd>
                {state.desiredState === 'scheduled'
                  ? `Sí, con la versión ${state.versionNumber}`
                  : 'No: la versión activa no tiene programación.'}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Cron</dt>
              <dd>
                <code>{state.cron}</code> ({state.timezone})
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Estado</dt>
              <dd>{SYNC_TEXT[state.syncStatus]}</dd>
            </div>
          </dl>
          {state.nextRuns.length > 0 && (
            <div className="text-sm">
              <p className="text-muted-foreground">Próximos disparos</p>
              <ul className="list-disc pl-5">
                {state.nextRuns.map((time) => (
                  <li key={time}>{formatDateTime(time)}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
