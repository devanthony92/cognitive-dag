import type { ErrorClass, RunStatus, StepStatus, WaitingReason } from '@cognitive-dag/contracts';
import { cn } from '../../lib/utils';
import { ERROR_CLASS_LABELS } from '../../features/runs/status';
import { errorClassOf, serviceStateOf, statusLabelOf, type StatusSubject } from './service-state';
import { STATE_FILL_CLASS, STATE_TEXT_CLASS, StatusGlyph, type ServiceState } from './statusGlyphs';

interface Props {
  status: RunStatus | StepStatus;
  kind?: 'run' | 'step';
  /** Why a running step is waiting: makes the badge «Esperando» with the reason as its text. */
  waitingReason?: WaitingReason | null;
  /** Class of the error of a failed state, shown as text next to the label. */
  errorClass?: ErrorClass;
  className?: string;
}

/**
 * Status pill of a run or a step: 24 px, glyph + label (+ error class). The colour only reinforces:
 * remove it and the glyph and the text still say the state (The Never-Color-Alone Rule).
 */
export function StatusBadge({ status, kind = 'run', waitingReason, errorClass, className }: Props) {
  const subject = { kind, status, waitingReason } as StatusSubject;
  const state = serviceStateOf(subject);
  const errorLabel = errorClassOf(subject, errorClass);
  return (
    <span
      data-state={state}
      className={cn(
        'inline-flex h-6 items-center gap-1.5 rounded-station border border-line bg-raised px-2.5 text-label font-semibold tracking-[0.06em] whitespace-nowrap text-ink uppercase',
        className,
      )}
    >
      <StatusGlyph state={state} className={STATE_TEXT_CLASS[state]} />
      {statusLabelOf(subject)}
      {errorLabel && (
        <>
          <span aria-hidden="true">·</span>
          <span className="font-normal tracking-normal text-ink-muted normal-case">
            {ERROR_CLASS_LABELS[errorLabel].label}
          </span>
        </>
      )}
    </span>
  );
}

/**
 * The 18 px badge of a station: the state colour as fill, a 2 px ring in the ground colour and the
 * bare glyph in the ground colour. The label is for assistive technology only.
 */
export function StatusMark({
  state,
  label,
  className,
}: {
  state: ServiceState;
  label: string;
  className?: string;
}) {
  return (
    <span
      data-state={state}
      className={cn(
        'inline-flex size-[18px] shrink-0 items-center justify-center rounded-station border-2 border-ground text-ground',
        STATE_FILL_CLASS[state],
        className,
      )}
    >
      <StatusGlyph state={state} variant="bare" className="size-3" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
