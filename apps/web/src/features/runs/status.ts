import type { RunStatus, StepStatus } from '@cognitive-dag/contracts';

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
