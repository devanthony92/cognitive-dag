import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { RotateCw } from 'lucide-react';
import { NODE_CATALOG } from '@cognitive-dag/dag-schema';
import type { RunStep } from '@cognitive-dag/contracts';
import { ApiProblemError } from '../../api/client';
import { Button } from '../../components/ui/button';
import { ProblemAlert } from '../auth/ProblemAlert';
import { errorMessage } from './error-messages';
import { stepIoQuery } from './api';
import { StatusBadge } from './StatusBadge';
import {
  ERROR_CLASS_LABELS,
  WAITING_RATE_LIMIT_LABEL,
  formatDateTime,
  formatDuration,
} from './status';

interface Props {
  organizationId: string;
  runId: string;
  step: RunStep;
  label: string;
  now: number;
  /** F4 behind `resilience-enabled`: error class, rate limit wait, reuse and rerun from a node. */
  resilience?: boolean;
  /** The run this one repeats, to follow a reused node back to where it ran. */
  rerunOf?: string | null;
  /** Rerun from this node; only offered when the run has finished. */
  onRerunFrom?: () => void;
  rerunning?: boolean;
}

function Json({ title, value }: { title: string; value: unknown }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <div className="grid gap-1">
      <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
      <pre
        tabIndex={0}
        className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs break-words whitespace-pre-wrap"
      >
        {text}
      </pre>
    </div>
  );
}

/** Input and output of a step, read from Temporal on demand (decision 5C). */
function StepContent({
  organizationId,
  runId,
  step,
  rerunOf,
}: Pick<Props, 'organizationId' | 'runId' | 'step' | 'rerunOf'>) {
  // Logic nodes run inside the engine: they leave no payloads to show.
  const evaluatedInEngine = step.nodeType.startsWith('logic.');
  const reused = step.status === 'reused';
  const waiting = step.status === 'pending' || step.status === 'skipped';
  const io = useQuery({
    ...stepIoQuery(organizationId, runId, step.nodeId, step.status),
    enabled: !evaluatedInEngine && !waiting && !reused,
  });

  // A reused node ran in the original run: its content is read there, not here.
  if (reused) {
    return (
      <div className="grid gap-2 text-sm text-muted-foreground">
        <p>Este nodo no se ejecutó de nuevo: se reutilizó su salida de la ejecución original.</p>
        {rerunOf && (
          <Link
            to="/orgs/$organizationId/runs/$runId"
            params={{ organizationId, runId: rerunOf }}
            search={{ node: step.nodeId }}
            className="justify-self-start text-foreground underline"
          >
            Ver este nodo en la ejecución original
          </Link>
        )}
      </div>
    );
  }

  if (evaluatedInEngine) {
    return (
      <p className="text-sm text-muted-foreground">
        Este nodo se evalúa dentro del motor y no registra entrada ni salida.
      </p>
    );
  }
  if (waiting) {
    return (
      <p className="text-sm text-muted-foreground">
        {step.status === 'skipped'
          ? 'El nodo se omitió: su rama no se tomó.'
          : 'El nodo todavía no se ejecuta.'}
      </p>
    );
  }
  if (io.isPending) return <p className="text-sm text-muted-foreground">Cargando contenido…</p>;
  if (io.isError) {
    if (io.error instanceof ApiProblemError && io.error.problem.code === 'STEP_IO_EXPIRED') {
      return (
        <p className="text-sm text-muted-foreground">
          El contenido ya no está disponible: Temporal lo conserva solo durante su periodo de
          retención.
        </p>
      );
    }
    return <ProblemAlert error={io.error} />;
  }
  const { input, output, truncated } = io.data;
  if (input === undefined && output === undefined) {
    return <p className="text-sm text-muted-foreground">Sin contenido disponible.</p>;
  }
  return (
    <div className="grid gap-3">
      {input !== undefined && <Json title="Entrada" value={input} />}
      {output !== undefined && <Json title="Salida" value={output} />}
      {truncated && (
        <p className="text-xs text-muted-foreground">
          El contenido es largo y se muestra recortado.
        </p>
      )}
    </div>
  );
}

/** Side panel with the detail of the selected node of a run. */
export function StepPanel({
  organizationId,
  runId,
  step,
  label,
  now,
  resilience = false,
  rerunOf = null,
  onRerunFrom,
  rerunning = false,
}: Props) {
  const duration =
    step.durationMs ??
    (step.status === 'running' && step.startedAt
      ? Math.max(0, now - Date.parse(step.startedAt))
      : null);
  const typeLabel = (NODE_CATALOG as Record<string, { label: string } | undefined>)[step.nodeType]
    ?.label;

  // Only activities have attempts: triggers and logic nodes run inside the engine, and skipped or
  // pending nodes never started.
  const category = (NODE_CATALOG as Record<string, { category: string } | undefined>)[step.nodeType]
    ?.category;
  const showAttempts =
    category !== 'trigger' &&
    category !== 'logic' &&
    step.status !== 'skipped' &&
    step.status !== 'pending' &&
    step.status !== 'reused';

  const errorClass =
    resilience && step.error?.class ? ERROR_CLASS_LABELS[step.error.class] : undefined;
  const waitingForLimit = resilience && step.waitingReason === 'rate_limited';

  return (
    <div className="grid gap-4">
      <div className="min-w-0">
        <h3 className="truncate text-base font-semibold" title={label}>
          {label}
        </h3>
        <p className="truncate text-xs text-muted-foreground">
          {typeLabel ?? step.nodeType} · {step.nodeId}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Estado</dt>
        <dd>
          <StatusBadge status={step.status} kind="step" />
          {waitingForLimit && (
            <p role="status" className="mt-1 text-xs font-medium text-amber-900">
              {WAITING_RATE_LIMIT_LABEL}
            </p>
          )}
        </dd>
        {showAttempts && (
          <>
            <dt className="text-muted-foreground">Intentos</dt>
            <dd>{step.attempts}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Duración</dt>
        <dd>{duration === null ? '—' : formatDuration(duration)}</dd>
        <dt className="text-muted-foreground">Inicio</dt>
        <dd>{step.startedAt ? formatDateTime(step.startedAt) : '—'}</dd>
        <dt className="text-muted-foreground">Fin</dt>
        <dd>{step.finishedAt ? formatDateTime(step.finishedAt) : '—'}</dd>
      </dl>
      {step.error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 p-3 text-sm text-destructive"
        >
          <p className="font-medium break-words">{errorMessage(step.error)}</p>
          <p className="mt-1 font-mono text-xs break-all">{step.error.code}</p>
          {errorClass && (
            <p className="mt-2 text-xs">
              <span className="font-medium">Clase de error: {errorClass.label}.</span>{' '}
              {errorClass.hint}
            </p>
          )}
        </div>
      )}
      {onRerunFrom && (
        <div className="grid gap-1">
          <Button variant="outline" size="sm" disabled={rerunning} onClick={onRerunFrom}>
            <RotateCw aria-hidden />
            {rerunning ? 'Reejecutando…' : 'Reejecutar desde aquí'}
          </Button>
          <p className="text-xs text-muted-foreground">
            Reutiliza lo que ya salió bien antes de este nodo, en la misma versión.
          </p>
        </div>
      )}
      <section aria-label="Contenido del nodo" className="grid gap-2">
        <h3 className="text-sm font-semibold">Entrada y salida</h3>
        <StepContent organizationId={organizationId} runId={runId} step={step} rerunOf={rerunOf} />
      </section>
    </div>
  );
}
