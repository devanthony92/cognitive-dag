import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { History, Play } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import { versionQuery, versionsQuery } from '../workflows/api';
import { RunDialog } from './RunDialog';
import { useRunPermission } from './permissions';
import { runBlockReason } from './runnable';
import { triggerFieldsOf } from './run-input';

interface Props {
  organizationId: string;
  workflowId: string;
  workflowName: string;
  /** Also offers the link to the list of runs (the editor does; the list itself does not). */
  showHistory?: boolean;
}

/**
 * Runs the active version. Only owner and editor can (F8, ADR-0082); for a viewer the button is
 * disabled and says why. While the version cannot run, the button is disabled and the reason stays
 * on screen next to it.
 */
export function RunButton({ organizationId, workflowId, workflowName, showHistory }: Props) {
  const reasonId = useId();
  const versions = useQuery(versionsQuery(organizationId, workflowId));
  const active = versions.data?.find((version) => version.active);
  const activeVersion = useQuery({
    ...versionQuery(organizationId, workflowId, active?.number ?? 0),
    enabled: active !== undefined,
  });
  const [open, setOpen] = useState(false);
  const { canExecute, blockedReason } = useRunPermission(organizationId);

  const fields = useMemo(
    () => triggerFieldsOf(activeVersion.data?.definition),
    [activeVersion.data?.definition],
  );

  const loading = versions.isPending || (active !== undefined && activeVersion.isPending);
  const reason = blockedReason
    ? blockedReason
    : loading
      ? undefined
      : versions.isError || activeVersion.isError
        ? 'No se pudo cargar la versión activa.'
        : runBlockReason(activeVersion.data?.definition, active !== undefined);
  const blocked =
    !canExecute || loading || reason !== undefined || activeVersion.data === undefined;

  return (
    <>
      {showHistory && (
        <Button variant="outline" size="icon" asChild>
          <Link
            aria-label="Ejecuciones"
            title="Ejecuciones: historial de este workflow"
            to="/orgs/$organizationId/workflows/$workflowId/runs"
            params={{ organizationId, workflowId }}
          >
            <History aria-hidden />
          </Link>
        </Button>
      )}
      {reason && (
        <p id={reasonId} className="order-last w-full text-right text-xs text-muted-foreground">
          {reason}
        </p>
      )}
      <Button
        disabled={blocked}
        aria-describedby={reason ? reasonId : undefined}
        onClick={() => setOpen(true)}
      >
        <Play aria-hidden />
        Ejecutar
      </Button>
      {activeVersion.data && (
        <RunDialog
          // A fresh form for every opening and every version.
          key={`${activeVersion.data.number}-${open}`}
          open={open}
          onOpenChange={setOpen}
          organizationId={organizationId}
          workflowId={workflowId}
          workflowName={workflowName}
          versionNumber={activeVersion.data.number}
          fields={fields}
        />
      )}
    </>
  );
}
