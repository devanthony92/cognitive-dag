import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { DagDefinitionSchema } from '@cognitive-dag/dag-schema';
import type { Compilation } from '@cognitive-dag/contracts';
import { ApiProblemError } from '../../api/client';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { ProblemAlert } from '../auth/ProblemAlert';
import { formatCostUsd, formatTokens } from '../llm/format';
import { ApplyPanel } from './ApplyPanel';
import { compilationQuery, compilationResultQuery, hasContent, isFinalStatus } from './api';
import { STATUS_LABEL, failureMessage } from './messages';
import { ResultPreview } from './ResultPreview';

interface Props {
  organizationId: string;
  compilationId: string;
  canWrite: boolean;
  /** Back to the form to describe it again. */
  onRetry: () => void;
}

/** Status and metrics of the compilation, then its preview and the way to apply it. */
export function CompilationView({ organizationId, compilationId, canWrite, onRetry }: Props) {
  const queryClient = useQueryClient();
  const status = useQuery(compilationQuery(organizationId, compilationId));
  const compilation = status.data;
  const final = compilation !== undefined && isFinalStatus(compilation);

  // The recent list was read while it was still in progress: read it again once it ends.
  useEffect(() => {
    if (final) void queryClient.invalidateQueries({ queryKey: ['compilations', organizationId] });
  }, [final, queryClient, organizationId]);

  if (status.isError && !compilation) {
    return (
      <Card>
        <CardContent>
          <ProblemAlert error={status.error} />
        </CardContent>
      </Card>
    );
  }
  if (!compilation) {
    return (
      <div role="status" className="grid gap-3">
        <span className="sr-only">Cargando la compilación…</span>
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Compilación
          <span
            role="status"
            className="rounded-full border border-line px-2 py-0.5 text-body-sm font-medium"
            aria-label={`Estado: ${STATUS_LABEL[compilation.status]}`}
          >
            {STATUS_LABEL[compilation.status]}
          </span>
        </CardTitle>
        <CardDescription>
          {compilation.mode === 'regenerate' ? 'Regenerar el borrador' : 'Workflow nuevo'} ·{' '}
          {new Date(compilation.createdAt).toLocaleString('es')}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {!isFinalStatus(compilation) && (
          <p className="text-body-sm text-ink-muted">
            {compilation.status === 'queued'
              ? 'Esperando turno para compilar…'
              : 'El modelo está armando el workflow. Puedes cerrar esta página: la compilación sigue y aparecerá en las recientes.'}
          </p>
        )}
        {compilation.status === 'failed' && <FailureNotice compilation={compilation} />}
        {isFinalStatus(compilation) && <Metrics compilation={compilation} />}
        {hasContent(compilation) && (
          <Content
            organizationId={organizationId}
            compilation={compilation}
            canWrite={canWrite}
            onRetry={onRetry}
          />
        )}
        {compilation.status === 'failed' && !compilation.hasFallback && (
          <div>
            <Button variant="secondary" onClick={onRetry}>
              Intentar de nuevo
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FailureNotice({ compilation }: { compilation: Compilation }) {
  return (
    <Alert variant="destructive">
      <AlertDescription>
        <p className="font-medium">La compilación falló.</p>
        <p>{failureMessage(compilation)}</p>
        {compilation.errorCode && (
          <p className="mt-1 text-body-sm text-ink-muted">Código: {compilation.errorCode}</p>
        )}
        {compilation.hasFallback && (
          <p className="mt-1">
            El último intento cumplía el esquema pero tiene errores de validación: puedes abrirlo
            como borrador y corregirlo a mano.
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}

function Metrics({ compilation }: { compilation: Compilation }) {
  const items: [string, string][] = [
    ['Modelo', compilation.model],
    ['Llamadas', String(compilation.calls)],
    ['Reparaciones', String(compilation.repairs)],
    ['Tokens', formatTokens(compilation.tokensUsed)],
    ['Costo estimado', formatCostUsd(compilation.costMicroUsd)],
  ];
  return (
    <dl
      aria-label="Métricas de la compilación"
      className="flex flex-wrap gap-x-6 gap-y-2 text-body-sm"
    >
      {items.map(([term, value]) => (
        <div key={term}>
          <dt className="text-body-sm text-ink-muted">{term}</dt>
          <dd className="font-medium text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Content({
  organizationId,
  compilation,
  canWrite,
  onRetry,
}: {
  organizationId: string;
  compilation: Compilation;
  canWrite: boolean;
  onRetry: () => void;
}) {
  const result = useQuery(compilationResultQuery(organizationId, compilation.id));
  const parsed = useMemo(
    () => (result.data ? DagDefinitionSchema.safeParse(result.data.definition) : undefined),
    [result.data],
  );

  if (result.isPending) {
    return (
      <div role="status" className="grid gap-3">
        <span className="sr-only">Cargando la vista previa…</span>
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (result.isError) {
    if (
      result.error instanceof ApiProblemError &&
      result.error.problem.code === 'COMPILER_RESULT_EXPIRED'
    ) {
      return (
        <Alert>
          <AlertDescription>
            <p>El resultado expiró: el motor ya no guarda el contenido de esta compilación.</p>
            <Button className="mt-2" variant="secondary" onClick={onRetry}>
              Volver a compilar
            </Button>
          </AlertDescription>
        </Alert>
      );
    }
    return <ProblemAlert error={result.error} />;
  }
  if (!parsed?.success) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          No se pudo mostrar la vista previa: la definición generada no cumple el formato del
          editor.
        </AlertDescription>
      </Alert>
    );
  }

  const { omittedSensitiveFields, validation } = result.data;
  return (
    <div className="grid gap-4">
      <h3 className="text-title font-semibold">
        {result.data.kind === 'fallback' ? 'Último intento' : 'Vista previa'}:{' '}
        <span className="font-normal">{result.data.title}</span>
      </h3>
      <ResultPreview definition={parsed.data} errors={validation.errors} />

      {omittedSensitiveFields.length > 0 && (
        <Alert>
          <AlertDescription>
            <p className="font-medium">Campos sensibles que debes completar tú:</p>
            <ul className="list-disc pl-5">
              {omittedSensitiveFields.map((item) => (
                <li key={`${item.nodeId}.${item.field}`}>
                  <code>{item.nodeId}</code> → <code>{item.field}</code>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-body-sm text-ink-muted">
              El compilador nunca decide destinos, URLs ni credenciales: no se podrá publicar hasta
              completarlos.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {validation.errors.length > 0 && (
        <section aria-label="Errores de validación" className="text-body-sm">
          <p className="font-medium text-state-failed">
            {validation.errors.length}{' '}
            {validation.errors.length === 1 ? 'error de validación' : 'errores de validación'}
          </p>
          <ul className="list-disc pl-5">
            {validation.errors.map((error, index) => (
              <li key={`${error.code}-${index}`}>
                {error.location.node ? <code>{error.location.node}</code> : null}
                {error.location.node ? ': ' : ''}
                {error.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ApplyPanel
        organizationId={organizationId}
        compilation={compilation}
        result={result.data}
        definition={parsed.data}
        canWrite={canWrite}
      />
    </div>
  );
}
