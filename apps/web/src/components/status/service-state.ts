import type { ErrorClass, RunStatus, StepStatus, WaitingReason } from '@cognitive-dag/contracts';
import {
  RUN_STATUS_LABELS,
  STEP_STATUS_LABELS,
  WAITING_REASON_LABELS,
} from '../../features/runs/status';
import type { ServiceState } from './statusGlyphs';

export type { ServiceState } from './statusGlyphs';

export type StatusSubject =
  | { kind: 'run'; status: RunStatus; waitingReason?: WaitingReason | null }
  | { kind: 'step'; status: StepStatus; waitingReason?: WaitingReason | null };

const STEP_STATE: Record<StepStatus, ServiceState> = {
  pending: 'pending',
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  skipped: 'skipped',
  cancelled: 'cancelled',
  reused: 'reused',
};

const RUN_STATE: Record<RunStatus, ServiceState> = {
  queued: 'waiting',
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  cancelled: 'cancelled',
  timed_out: 'failed',
};

/** Design state of a run or step (design contract §1). A waiting reason makes a running one «Esperando». */
export function serviceStateOf(subject: StatusSubject): ServiceState {
  if (subject.waitingReason && subject.status === 'running') return 'waiting';
  return subject.kind === 'run' ? RUN_STATE[subject.status] : STEP_STATE[subject.status];
}

/** Spanish label of the status; a waiting reason replaces «En curso» with its own text. */
export function statusLabelOf(subject: StatusSubject): string {
  if (subject.waitingReason && subject.status === 'running') {
    return WAITING_REASON_LABELS[subject.waitingReason];
  }
  return subject.kind === 'run'
    ? RUN_STATUS_LABELS[subject.status]
    : STEP_STATUS_LABELS[subject.status];
}

/** The class of error a failed state shows; a timed-out run is always a time-out. */
export function errorClassOf(
  subject: StatusSubject,
  errorClass?: ErrorClass,
): ErrorClass | undefined {
  if (subject.kind === 'run' && subject.status === 'timed_out') return 'timeout';
  return serviceStateOf(subject) === 'failed' ? errorClass : undefined;
}
