import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { VersionSummary, WorkflowBody } from '@cognitive-dag/contracts';
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
import { ProblemAlert } from '../auth/ProblemAlert';
import { downloadDefinition, exportFileName } from './export';
import { toEditableDefinition } from './model';
import {
  activateVersion,
  copyVersionToDraft,
  versionQuery,
  versionsKey,
  versionsQuery,
  workflowsKey,
} from './api';

interface Props {
  organizationId: string;
  workflowId: string;
  canWrite: boolean;
  /** Name of the workflow, for the name of the exported file. */
  workflowName: string;
  /** Revision of the draft the editor is working on, sent as `If-Match` when copying. */
  revision: number;
  /** The server replaced the draft: the editor must start again from this one. */
  onDraftReplaced: (workflow: WorkflowBody) => void;
  /** The draft changed elsewhere: the editor reloads it from the server. */
  onReload: () => void;
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });

const isConflict = (error: unknown): error is ApiProblemError =>
  error instanceof ApiProblemError && error.problem.status === 409;

/** History of published versions; owners and editors can activate one or copy it to the draft. */
export function VersionsPanel({
  organizationId,
  workflowId,
  canWrite,
  workflowName,
  revision,
  onDraftReplaced,
  onReload,
}: Props) {
  const queryClient = useQueryClient();
  const versions = useQuery(versionsQuery(organizationId, workflowId));
  const [copying, setCopying] = useState<VersionSummary | undefined>();

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: versionsKey(organizationId, workflowId) });
    await queryClient.invalidateQueries({ queryKey: workflowsKey(organizationId) });
  };

  const activate = useMutation<VersionSummary, Error, number>({
    mutationFn: (number) => activateVersion(organizationId, workflowId, number),
    onSettled: refresh,
  });

  const copy = useMutation<WorkflowBody, Error, number>({
    mutationFn: (number) => copyVersionToDraft(organizationId, workflowId, number, revision),
    onSuccess: (workflow) => {
      setCopying(undefined);
      onDraftReplaced(workflow);
    },
    onError: (error) => {
      // A conflict is answered outside the dialog, with the reload button.
      if (isConflict(error)) setCopying(undefined);
    },
  });

  const exportVersion = useMutation<void, Error, number>({
    mutationFn: async (number) => {
      const body = await queryClient.fetchQuery(versionQuery(organizationId, workflowId, number));
      downloadDefinition(
        toEditableDefinition(body.definition).definition,
        exportFileName(workflowName, number),
      );
    },
  });

  const copyConflict = isConflict(copy.error) ? copy.error : undefined;
  const activateConflict = isConflict(activate.error) ? activate.error : undefined;
  const conflict = copyConflict ?? activateConflict;
  const failure = [copy.error, activate.error, exportVersion.error, versions.error].find(
    (error) => error != null && !isConflict(error),
  );

  return (
    <div className="grid gap-3">
      {conflict !== undefined && (
        <Alert variant="destructive">
          <AlertDescription>
            <p>{conflict.problem.detail}</p>
            <p>Recarga para ver la última revisión.</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => {
                copy.reset();
                activate.reset();
                if (copyConflict) onReload();
                else void versions.refetch();
              }}
            >
              Recargar
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {failure != null && <ProblemAlert error={failure} />}

      {versions.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Todavía no hay versiones publicadas. Publica el borrador para crear la primera.
        </p>
      )}
      <ul className="grid gap-2">
        {versions.data?.map((version) => (
          <li key={version.number} className="rounded-md border p-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium">Versión {version.number}</span>
              {version.active && (
                <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                  Activa
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatDate(version.publishedAt)} · {version.publishedBy.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {version.nodeCount} nodos · {version.edgeCount} conexiones
            </p>
            {version.note && <p className="mt-1">{version.note}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                aria-label={`Exportar versión ${version.number} como JSON`}
                disabled={exportVersion.isPending}
                onClick={() => exportVersion.mutate(version.number)}
              >
                Exportar JSON
              </Button>
            </div>
            {canWrite && (
              <div className="mt-2 flex flex-wrap gap-2">
                {!version.active && (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Activar versión ${version.number}`}
                    disabled={activate.isPending}
                    onClick={() => {
                      activate.reset();
                      activate.mutate(version.number);
                    }}
                  >
                    Activar
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Copiar versión ${version.number} al borrador`}
                  onClick={() => {
                    copy.reset();
                    setCopying(version);
                  }}
                >
                  Copiar al borrador
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <Dialog open={copying !== undefined} onOpenChange={(open) => !open && setCopying(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copiar la versión {copying?.number} al borrador</DialogTitle>
            <DialogDescription>
              Esto reemplazará el borrador actual, incluidos los cambios sin guardar, por la
              definición de esa versión. Las versiones publicadas no cambian.
            </DialogDescription>
          </DialogHeader>
          {copy.isError && !isConflict(copy.error) && <ProblemAlert error={copy.error} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopying(undefined)}>
              Cancelar
            </Button>
            <Button
              disabled={copy.isPending}
              onClick={() => copying && copy.mutate(copying.number)}
            >
              Reemplazar borrador
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
