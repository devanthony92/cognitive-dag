import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { ApiProblemError } from '../../api/client';
import type { Approval, ApprovalDecision, ApprovalStatus } from '@cognitive-dag/contracts';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Label } from '../../components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { Textarea } from '../../components/ui/textarea';
import { ProblemAlert } from '../auth/ProblemAlert';
import { formatDateTime } from '../runs/status';
import {
  approvalCountKey,
  approvalKey,
  approvalQuery,
  approvalsQuery,
  decideApproval,
  type ApprovalTab,
} from './api';

const STATUS_TEXT: Record<ApprovalStatus, string> = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  timed_out: 'Vencida',
  cancelled: 'Cancelada',
};

const COMMENT_MAX = 500;

/**
 * Inbox of approvals (F7, US4): what the person can decide, and the history. The URL's `approval`
 * parameter opens the detail, which is where the email links to.
 */
export function ApprovalsPage({
  organizationId,
  selectedId,
}: {
  organizationId: string;
  selectedId: string | undefined;
}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<ApprovalTab>('pending');
  const list = useInfiniteQuery(approvalsQuery(organizationId, tab));
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  const open = (approvalId: string | undefined) =>
    void navigate({
      to: '/orgs/$organizationId/approvals',
      params: { organizationId },
      search: approvalId === undefined ? {} : { approval: approvalId },
    });

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Aprobaciones</h1>
        <p className="text-muted-foreground">
          Solicitudes de ejecuciones que esperan una decisión. No ves las de las ejecuciones que
          iniciaste tú: las decide otra persona.
        </p>
      </section>

      <Card>
        <CardHeader>
          <div role="tablist" aria-label="Estado de las solicitudes" className="flex gap-2">
            {(
              [
                ['pending', 'Pendientes'],
                ['resolved', 'Historial'],
              ] as const
            ).map(([id, title]) => (
              <Button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                variant={tab === id ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setTab(id)}
              >
                {title}
              </Button>
            ))}
          </div>
          <CardTitle className="sr-only">
            {tab === 'pending' ? 'Pendientes' : 'Historial'}
          </CardTitle>
          <CardDescription className="sr-only">Lista de solicitudes</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {list.isPending && <p role="status">Cargando solicitudes…</p>}
          {list.isError && <ProblemAlert error={list.error} />}
          {list.isSuccess && items.length === 0 && (
            <p className="text-muted-foreground">
              {tab === 'pending'
                ? 'No tienes solicitudes pendientes.'
                : 'Todavía no hay solicitudes resueltas.'}
            </p>
          )}
          {items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Paso</TableHead>
                  <TableHead>Solicitada</TableHead>
                  <TableHead>{tab === 'pending' ? 'Vence' : 'Resultado'}</TableHead>
                  <TableHead>
                    <span className="sr-only">Acciones</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.workflowName}</TableCell>
                    <TableCell>{item.nodeLabel}</TableCell>
                    <TableCell>{formatDateTime(item.requestedAt)}</TableCell>
                    <TableCell>
                      {tab === 'pending'
                        ? formatDateTime(item.expiresAt)
                        : `${STATUS_TEXT[item.status]}${item.decidedBy ? ` por ${item.decidedBy.name}` : ''}`}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        aria-label={`Ver solicitud de ${item.workflowName}`}
                        onClick={() => open(item.id)}
                      >
                        Ver
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {list.hasNextPage && (
            <Button
              type="button"
              variant="secondary"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              Cargar más
            </Button>
          )}
        </CardContent>
      </Card>

      {selectedId !== undefined && (
        <ApprovalDetailDialog
          organizationId={organizationId}
          approvalId={selectedId}
          onClose={() => open(undefined)}
        />
      )}
    </div>
  );
}

function ApprovalDetailDialog({
  organizationId,
  approvalId,
  onClose,
}: {
  organizationId: string;
  approvalId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const detail = useQuery(approvalQuery(organizationId, approvalId));
  const [comment, setComment] = useState('');

  const decide = useMutation<Approval, Error, ApprovalDecision>({
    mutationFn: (decision) =>
      decideApproval(organizationId, approvalId, {
        decision,
        ...(comment.trim() === '' ? {} : { comment: comment.trim() }),
      }),
    onSettled: async () => {
      // Whatever the outcome, what the screens show is looked up again: a 409 means it changed.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: approvalKey(organizationId, approvalId) }),
        queryClient.invalidateQueries({ queryKey: ['approvals', organizationId] }),
        queryClient.invalidateQueries({ queryKey: approvalCountKey(organizationId) }),
      ]);
    },
    onSuccess: onClose,
  });

  const expired =
    detail.error instanceof ApiProblemError &&
    detail.error.problem.code === 'APPROVAL_CONTENT_EXPIRED';
  const data = detail.data;
  const canDecide = data?.status === 'pending' && data.canDecide === true;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            {data ? `${data.workflowName}: ${data.nodeLabel}` : 'Solicitud'}
          </DialogTitle>
          <DialogDescription>
            {data
              ? `Solicitada el ${formatDateTime(data.requestedAt)}. ${
                  data.status === 'pending'
                    ? `Vence el ${formatDateTime(data.expiresAt)}.`
                    : `${STATUS_TEXT[data.status]}${data.resolvedAt ? ` el ${formatDateTime(data.resolvedAt)}` : ''}${data.decidedBy ? ` por ${data.decidedBy.name}` : ''}.`
                }`
              : 'Cargando la solicitud…'}
          </DialogDescription>
        </DialogHeader>

        {detail.isPending && <p role="status">Cargando…</p>}
        {expired && (
          <Alert>
            <AlertDescription>
              El mensaje de esta solicitud ya no está disponible: el historial del motor venció.
            </AlertDescription>
          </Alert>
        )}
        {detail.isError && !expired && <ProblemAlert error={detail.error} />}
        {data && (
          <div className="grid gap-3">
            <div>
              <p className="text-sm font-medium">Mensaje</p>
              <p className="rounded-md border bg-muted p-3 text-sm whitespace-pre-wrap">
                {data.message}
              </p>
            </div>
            {data.status !== 'pending' && data.comment && (
              <div>
                <p className="text-sm font-medium">Comentario</p>
                <p className="text-sm whitespace-pre-wrap">{data.comment}</p>
              </div>
            )}
            {canDecide && (
              <div className="grid gap-1.5">
                <Label htmlFor="approval-comment">Comentario (opcional)</Label>
                <Textarea
                  id="approval-comment"
                  value={comment}
                  maxLength={COMMENT_MAX}
                  onChange={(event) => setComment(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {comment.length}/{COMMENT_MAX}
                </p>
              </div>
            )}
            {data.status === 'pending' && !canDecide && (
              <p className="text-sm text-muted-foreground">
                Iniciaste esta ejecución, así que la decide otra persona.
              </p>
            )}
          </div>
        )}
        {decide.isError && <ProblemAlert error={decide.error} />}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
          {canDecide && (
            <>
              <Button
                type="button"
                variant="danger"
                disabled={decide.isPending}
                onClick={() => decide.mutate('rejected')}
              >
                Rechazar
              </Button>
              <Button
                type="button"
                disabled={decide.isPending}
                onClick={() => decide.mutate('approved')}
              >
                Aprobar
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
