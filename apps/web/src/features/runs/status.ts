import type { ErrorClass, RunStatus, StepStatus } from '@cognitive-dag/contracts';

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: 'En cola',
  running: 'En curso',
  succeeded: 'Completada',
  failed: 'Fallida',
  cancelled: 'Cancelada',
  timed_out: 'Vencida',
};

export const STEP_STATUS_LABELS: Record<StepStatus, string> = {
  pending: 'Pendiente',
  running: 'En curso',
  succeeded: 'Completado',
  failed: 'Fallido',
  skipped: 'Omitido',
  cancelled: 'Cancelado',
  reused: 'Reutilizado',
};

/** What each class of failure means for the person reading the run (taxonomy of F4). */
export const ERROR_CLASS_LABELS: Record<ErrorClass, { label: string; hint: string }> = {
  transient: {
    label: 'Transitorio',
    hint: 'Falla pasajera del servicio: se reintentó y siguió fallando.',
  },
  rate_limited: {
    label: 'Límite de uso',
    hint: 'El servicio o la organización alcanzó su límite y la espera se agotó.',
  },
  timeout: { label: 'Tiempo agotado', hint: 'El nodo tardó más de lo permitido.' },
  permanent: {
    label: 'Permanente',
    hint: 'Repetirlo no ayuda: revisa la configuración del nodo.',
  },
  invalid_output: {
    label: 'Salida inválida',
    hint: 'El modelo no cumplió el formato esperado tras los intentos de reparación.',
  },
  budget_exhausted: {
    label: 'Presupuesto agotado',
    hint: 'Se agotó el presupuesto de tokens de la ejecución o del día.',
  },
};

export const WAITING_RATE_LIMIT_LABEL = 'Esperando por el límite';

/** Why a running step is waiting (F7 adds a human decision and an open circuit). */
export const WAITING_REASON_LABELS = {
  rate_limited: WAITING_RATE_LIMIT_LABEL,
  approval: 'Esperando una aprobación',
  circuit_open: 'Esperando: el destino falla y el circuito está abierto',
} as const;

const FINAL: ReadonlySet<RunStatus> = new Set(['succeeded', 'failed', 'cancelled', 'timed_out']);

export const isFinalRun = (status: RunStatus): boolean => FINAL.has(status);

/** Tailwind classes of a status chip; the label always travels with the color. */
export const STATUS_TONE: Record<RunStatus | StepStatus, string> = {
  queued: 'border-slate-300 bg-slate-100 text-slate-800',
  pending: 'border-slate-300 bg-slate-100 text-slate-800',
  running: 'border-sky-300 bg-sky-100 text-sky-900',
  succeeded: 'border-emerald-300 bg-emerald-100 text-emerald-900',
  failed: 'border-red-300 bg-red-100 text-red-900',
  cancelled: 'border-amber-300 bg-amber-100 text-amber-900',
  timed_out: 'border-amber-300 bg-amber-100 text-amber-900',
  skipped: 'border-dashed border-slate-300 bg-transparent text-slate-600',
  reused: 'border-violet-300 bg-violet-100 text-violet-900',
};

/** "850 ms", "3,2 s", "2 min 5 s". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1).replace('.', ',').replace(',0', '')} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds % 60)} s`;
}

/** Duration of a run so far, or in total once it finished. */
export function runDurationMs(
  run: { createdAt: string; startedAt: string | null; finishedAt: string | null },
  now: number,
): number {
  const start = Date.parse(run.startedAt ?? run.createdAt);
  const end = run.finishedAt === null ? now : Date.parse(run.finishedAt);
  return Math.max(0, end - start);
}

export const formatDateTime = (iso: string): string => new Date(iso).toLocaleString('es');

/** Who started a run when no person did and the origin is unknown. */
export const SYSTEM_ORIGIN = 'Sistema';

/** Who or what started a run: the person, or "Webhook" / "Programación" (F7). */
export function originOf(run: {
  triggeredBy: { name: string } | null;
  trigger: { kind: 'manual' | 'webhook' | 'schedule' };
}): string {
  if (run.triggeredBy) return run.triggeredBy.name;
  if (run.trigger.kind === 'webhook') return 'Webhook';
  if (run.trigger.kind === 'schedule') return 'Programación';
  return SYSTEM_ORIGIN;
}
