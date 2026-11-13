import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import {
  CreateWorkflowRequestSchema,
  type Compilation,
  type CompilationResult,
} from '@cognitive-dag/contracts';
import type { DagDefinition } from '@cognitive-dag/dag-schema';
import { ApiProblemError } from '../../api/client';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { ProblemAlert } from '../auth/ProblemAlert';
import { createWorkflow, saveDraft, workflowKey, workflowsKey } from '../workflows/api';

interface Props {
  organizationId: string;
  compilation: Compilation;
  result: CompilationResult;
  definition: DagDefinition;
  canWrite: boolean;
}

const isConflict = (error: unknown): boolean =>
  error instanceof ApiProblemError && error.problem.code === 'DRAFT_CONFLICT';

/**
 * Applies the preview with the endpoints of workflows (F2, research R8): nothing is written until
 * the person asks. A new workflow is created and then its draft is saved at revision 1; an
 * existing one is replaced at the revision the compilation was asked from, so a change made
 * in between is a conflict and not an overwrite. The last attempt of a failed compilation is
 * opened the same way, with its validation errors showing in the editor.
 */
export function ApplyPanel({ organizationId, compilation, result, definition, canWrite }: Props) {
  if (!canWrite) {
    return (
      <p className="text-body-sm text-ink-muted">
        Tu rol no permite crear ni reemplazar borradores.
      </p>
    );
  }
  return compilation.mode === 'create' || compilation.workflowId === null ? (
    <CreateWorkflow organizationId={organizationId} result={result} definition={definition} />
  ) : (
    <ReplaceDraft
      organizationId={organizationId}
      workflowId={compilation.workflowId}
      baseRevision={compilation.baseDraftRevision ?? 1}
      result={result}
      definition={definition}
    />
  );
}

const labelFor = (result: CompilationResult, replacing: boolean): string => {
  if (result.kind === 'fallback') return 'Abrir el último intento como borrador';
  return replacing ? 'Reemplazar borrador' : 'Crear workflow con este borrador';
};

function CreateWorkflow({
  organizationId,
  result,
  definition,
}: Pick<Props, 'organizationId' | 'result' | 'definition'>) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(result.title);
  // The workflow exists after the first step; a retry only saves the draft again.
  const [createdId, setCreatedId] = useState<string | undefined>();

  const apply = useMutation<string, Error>({
    mutationFn: async () => {
      let workflowId = createdId;
      if (workflowId === undefined) {
        workflowId = (await createWorkflow(organizationId, name.trim())).id;
        setCreatedId(workflowId);
      }
      await saveDraft(organizationId, workflowId, 1, definition);
      return workflowId;
    },
    onSuccess: async (workflowId) => {
      await queryClient.invalidateQueries({ queryKey: workflowsKey(organizationId) });
      await navigate({
        to: '/orgs/$organizationId/workflows/$workflowId',
        params: { organizationId, workflowId },
      });
    },
  });

  // The same rule the API applies to the name of a workflow.
  const nameError = CreateWorkflowRequestSchema.safeParse({ name }).error?.issues[0]?.message;

  return (
    <div className="grid gap-3">
      <div className="grid max-w-md gap-2">
        <Label htmlFor="compiler-workflow-name">Nombre del workflow nuevo</Label>
        <Input
          id="compiler-workflow-name"
          value={name}
          disabled={createdId !== undefined}
          aria-invalid={nameError !== undefined}
          onChange={(event) => setName(event.target.value)}
        />
        {nameError && <p className="text-body-sm text-state-failed">{nameError}</p>}
      </div>
      {apply.isError && createdId !== undefined && (
        <Alert variant="destructive">
          <AlertDescription>
            <p>
              El workflow «{name.trim()}» se creó, pero no se pudo guardar el borrador generado.
              Puedes reintentar o{' '}
              <Link
                to="/orgs/$organizationId/workflows/$workflowId"
                params={{ organizationId, workflowId: createdId }}
                className="underline"
              >
                abrirlo vacío
              </Link>
              .
            </p>
          </AlertDescription>
        </Alert>
      )}
      {apply.isError && <ProblemAlert error={apply.error} />}
      <div>
        <Button
          disabled={nameError !== undefined || apply.isPending}
          onClick={() => {
            apply.mutate();
          }}
        >
          {apply.isPending
            ? 'Guardando…'
            : createdId !== undefined
              ? 'Reintentar el guardado'
              : labelFor(result, false)}
        </Button>
      </div>
    </div>
  );
}

function ReplaceDraft({
  organizationId,
  workflowId,
  baseRevision,
  result,
  definition,
}: Pick<Props, 'organizationId' | 'result' | 'definition'> & {
  workflowId: string;
  baseRevision: number;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const replace = useMutation<unknown, Error>({
    mutationFn: () => saveDraft(organizationId, workflowId, baseRevision, definition),
    onSuccess: async () => {
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: workflowKey(organizationId, workflowId) });
      await queryClient.invalidateQueries({ queryKey: workflowsKey(organizationId) });
      await navigate({
        to: '/orgs/$organizationId/workflows/$workflowId',
        params: { organizationId, workflowId },
      });
    },
  });

  const conflict = isConflict(replace.error);

  return (
    <div className="grid gap-3">
      {replace.isError && !open && !conflict && <ProblemAlert error={replace.error} />}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => {
            replace.reset();
            setOpen(true);
          }}
        >
          {labelFor(result, true)}
        </Button>
        <Link
          to="/orgs/$organizationId/workflows/$workflowId"
          params={{ organizationId, workflowId }}
          className="text-body-sm underline underline-offset-4"
        >
          Volver al editor sin cambiar nada
        </Link>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Reemplazar el borrador?</DialogTitle>
            <DialogDescription>
              El borrador actual del workflow se sustituirá por este. Las versiones publicadas y la
              versión activa no cambian.
            </DialogDescription>
          </DialogHeader>
          {conflict && (
            <Alert variant="destructive">
              <AlertDescription>
                <p className="font-medium">El borrador cambió desde que pediste la compilación.</p>
                <p>
                  Para no pisar el trabajo de otra persona no se reemplazó nada. Abre el editor para
                  ver el borrador actual o vuelve a compilar.
                </p>
              </AlertDescription>
            </Alert>
          )}
          {replace.isError && !conflict && <ProblemAlert error={replace.error} />}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {conflict ? 'Cerrar' : 'Cancelar'}
            </Button>
            {conflict ? (
              <Button asChild>
                <Link
                  to="/orgs/$organizationId/workflows/$workflowId"
                  params={{ organizationId, workflowId }}
                >
                  Abrir el editor
                </Link>
              </Button>
            ) : (
              <Button
                variant="danger"
                disabled={replace.isPending}
                onClick={() => {
                  replace.mutate();
                }}
              >
                {replace.isPending ? 'Reemplazando…' : 'Reemplazar'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
