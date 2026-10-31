import { useQuery } from '@tanstack/react-query';
import { NODE_CATALOG } from '@cognitive-dag/dag-schema';
import type { RunStep } from '@cognitive-dag/contracts';
import { ApiProblemError } from '../../api/client';
import { ProblemAlert } from '../auth/ProblemAlert';
import { stepIoQuery } from './api';
import { StatusBadge } from './StatusBadge';
import { formatDateTime, formatDuration } from './status';

interface Props {
  organizationId: string;
  runId: string;
  step: RunStep;
  label: string;
  now: number;
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
function StepContent({ organizationId, runId, step }: Omit<Props, 'label' | 'now'>) {
  // Logic nodes run inside the engine: they leave no payloads to show.
  const evaluatedInEngine = step.nodeType.startsWith('logic.');
  const waiting = step.status === 'pending' || step.status === 'skipped';
  const io = useQuery({
    ...stepIoQuery(organizationId, runId, step.nodeId, step.status),
    enabled: !evaluatedInEngine && !waiting,
  });

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
export function StepPanel({ organizationId, runId, step, label, now }: Props) {
  const duration =
    step.durationMs ??
    (step.status === 'running' && step.startedAt
      ? Math.max(0, now - Date.parse(step.startedAt))
      : null);
  const typeLabel = (NODE_CATALOG as Record<string, { label: string } | undefined>)[step.nodeType]
    ?.label;

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
        </dd>
        <dt className="text-muted-foreground">Intentos</dt>
        <dd>{step.attempts}</dd>
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
          <p className="font-medium break-words">{step.error.message}</p>
          <p className="mt-1 font-mono text-xs break-all">{step.error.code}</p>
        </div>
      )}
      <section aria-label="Contenido del nodo" className="grid gap-2">
        <h3 className="text-sm font-semibold">Entrada y salida</h3>
        <StepContent organizationId={organizationId} runId={runId} step={step} />
      </section>
    </div>
  );
}
