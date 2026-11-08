import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { useState } from 'react';
import type { WebhookWithToken } from '@cognitive-dag/contracts';
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
import { formatDateTime } from '../runs/status';
import { regenerateWebhookToken, webhookKey, webhookQuery } from './api';

/**
 * The webhook of a workflow, in the panel of its `trigger.webhook` node (F7, US1 and US2). The
 * token is shown once, right after generating it; afterwards only its state is known, so losing it
 * means generating another, which cuts the old one off at once.
 */
export function WebhookPanel({
  organizationId,
  workflowId,
  canWrite,
}: {
  organizationId: string;
  workflowId: string;
  canWrite: boolean;
}) {
  const queryClient = useQueryClient();
  const webhook = useQuery(webhookQuery(organizationId, workflowId));
  // Held in memory only: it is not stored and disappears when the panel closes.
  const [fresh, setFresh] = useState<WebhookWithToken | undefined>();
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = useMutation({
    mutationFn: () => regenerateWebhookToken(organizationId, workflowId),
    onSuccess: async (created) => {
      setFresh(created);
      setCopied(false);
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: webhookKey(organizationId, workflowId) });
    },
  });

  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const state = webhook.data;
  return (
    <section aria-label="Webhook" className="mt-6 grid gap-3 border-t pt-4">
      <h3 className="text-sm font-semibold">Webhook</h3>
      {webhook.isPending && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {webhook.isError && <ProblemAlert error={webhook.error} />}

      {fresh && (
        <Alert>
          <AlertDescription className="grid gap-2">
            <p className="font-medium">
              Copia la URL ahora: no se volverá a mostrar. Quien la tenga puede ejecutar el
              workflow.
            </p>
            <code
              data-testid="webhook-url"
              className="rounded bg-muted p-2 text-xs break-all select-all"
            >
              {fresh.url}
            </code>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
                <Copy aria-hidden /> Copiar URL
              </Button>
              {copied && <span role="status">URL copiada.</span>}
              <Button type="button" variant="ghost" size="sm" onClick={() => setFresh(undefined)}>
                Ocultar
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {webhook.isSuccess && state === null && (
        <p className="text-sm text-muted-foreground">Todavía no hay un token para este webhook.</p>
      )}
      {state && (
        <dl className="grid gap-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Dirección</dt>
            <dd className="min-w-0 break-all">{state.urlBase}…</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Token</dt>
            <dd>
              Generación {state.generation}, el {formatDateTime(state.generatedAt)} por{' '}
              {state.generatedBy.name}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Estado</dt>
            <dd>
              {state.active
                ? 'Recibe eventos: hay una versión activa con este disparador.'
                : 'Sin versión activa con este disparador: responde 409 hasta que la actives.'}
            </dd>
          </div>
        </dl>
      )}

      {generate.isError && <ProblemAlert error={generate.error} />}
      {canWrite && webhook.isSuccess && (
        <div>
          <Button
            type="button"
            variant={state ? 'outline' : 'default'}
            size="sm"
            disabled={generate.isPending}
            onClick={() => (state ? setConfirming(true) : generate.mutate())}
          >
            {state ? 'Regenerar token' : 'Generar token'}
          </Button>
        </div>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Regenerar el token?</DialogTitle>
            <DialogDescription>
              El token actual deja de funcionar de inmediato. Quien lo use recibirá un error 401
              hasta que le des la URL nueva.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
            <Button type="button" disabled={generate.isPending} onClick={() => generate.mutate()}>
              Regenerar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
