/**
 * Security events the worker writes to its log (ADR-0038, ADR-0085). The names are stable: filter
 * logs by `event`. None carries content: no label, message, body, header, credential or cron.
 */
export const WORKER_SECURITY_EVENTS = [
  /** A request for approval expired without a decision. */
  'approval.timed_out',
  /** The probe of a half-open circuit succeeded and the circuit closed. */
  'circuit.closed',
  /** A scheduled firing ran more than `CAUGHT_UP_AFTER_MS` after its programmed time. */
  'schedule.caught_up',
  /** The reconciler gave up on a schedule after `MAX_SYNC_ATTEMPTS` consecutive failures. */
  'schedule.sync_failed',
] as const;

export type WorkerSecurityEvent = (typeof WORKER_SECURITY_EVENTS)[number];
