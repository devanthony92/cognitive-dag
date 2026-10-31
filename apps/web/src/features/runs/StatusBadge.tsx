import { cn } from '../../lib/utils';
import { RUN_STATUS_LABELS, STATUS_TONE, STEP_STATUS_LABELS } from './status';
import type { RunStatus, StepStatus } from '@cognitive-dag/contracts';

/** Status chip for a run or a step: text plus color, so it never relies on color alone. */
export function StatusBadge({
  status,
  kind = 'run',
  className,
}: {
  status: RunStatus | StepStatus;
  kind?: 'run' | 'step';
  className?: string;
}) {
  const label =
    kind === 'run'
      ? RUN_STATUS_LABELS[status as RunStatus]
      : STEP_STATUS_LABELS[status as StepStatus];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        STATUS_TONE[status],
        className,
      )}
    >
      {status === 'running' && (
        <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-sky-600" />
      )}
      {label}
    </span>
  );
}
