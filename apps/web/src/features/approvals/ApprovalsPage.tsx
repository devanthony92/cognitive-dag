import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { UserCheck } from 'lucide-react';
import { useState } from 'react';
import { ApiProblemError } from '../../api/client';
import type { Approval, ApprovalDecision, ApprovalStatus } from '@cognitive-dag/contracts';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { PageHeader } from '../../components/ui/page-header';
import { RowsSkeleton } from '../../components/ui/rows-skeleton';
import { STACKED } from '../../components/ui/table-stacked';
import { StatusBadge } from '../../components/status/StatusBadge';
import { CategoryIcon } from '../../components/category/CategoryIcon';
import { cn } from '../../lib/utils';
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

  const empty =
    tab === 'pending'
      ? 'No tienes solicitudes pendientes.'
      : 'Todavía no hay solicitudes resueltas.';

  return (
    <div className="grid w-full gap-6">
      <PageHeader
        title="Aprobaciones"
        description="Solicitudes de ejecuciones que esperan una decisión. No ves las de las ejecuciones que iniciaste tú: las decide otra persona."
      />

      <div role="tablist" aria-label="Estado de las solicitudes" className="flex flex-wrap gap-2">
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
            onClick={() => setTab(id)}
          >
            {title}
          </Button>
        ))}
      </div>

      {list.isPending && <RowsSkeleton rows={4} />}
      {list.isError && <ProblemAlert error={list.error} />}
      {list.isSuccess && items.length === 0 && (
        <EmptyState
          icon={UserCheck}
          title={empty}
          action={
            <Button
              type="button"
              variant="secondary"
              onClick={() => setTab(tab === 'pending' ? 'resolved' : 'pending')}
            >
              {tab === 'pending' ? 'Ver historial' : 'Ver pendientes'}
            </Button>
          }
        />
      )}
      {items.length > 0 && (
        <Table>
          <TableHeader className={STACKED.head}>
            <TableRow>
              <TableHead>Estado</TableHead>
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
              <TableRow key={item.id} className={STACKED.row}>
                <TableCell className={STACKED.cell}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {item.status === 'pending' ? (
                      <StatusBadge status="running" kind="step" waitingReason="approval" />
                    ) : (
                      <span className="text-body font-semibold">{STATUS_TEXT[item.status]}</span>
                    )}
                    <CategoryIcon category="approval" showLabel className="[&_svg]:size-5" />
                  </div>
                </TableCell>
                <TableCell className={cn(STACKED.cell, 'min-w-40 whitespace-normal')}>
                  {item.workflowName}
                </TableCell>
                <TableCell className={STACKED.cell}>{item.nodeLabel}</TableCell>
                <TableCell className={cn(STACKED.cell, 'tabular-nums')}>
                  {formatDateTime(item.requestedAt)}
                </TableCell>
                <TableCell className={cn(STACKED.cell, 'tabular-nums')}>
                  {tab === 'pending'
                    ? formatDateTime(item.expiresAt)
                    : item.decidedBy
                      ? `${STATUS_TEXT[item.status]} por ${item.decidedBy.name}`
                      : STATUS_TEXT[item.status]}
                </TableCell>
                <TableCell className={STACKED.cell}>
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
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {list.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
          </Button>
        </div>
      )}

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
              : 'Un momento: se carga la solicitud.'}
          </DialogDescription>
        </DialogHeader>

        {detail.isPending && <RowsSkeleton rows={2} />}
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
              <p className="text-body-sm font-semibold">Mensaje</p>
              <p className="rounded-md border border-line bg-surface p-3 text-body-sm whitespace-pre-wrap">
                {data.message}
              </p>
            </div>
            {data.status !== 'pending' && data.comment && (
              <div>
                <p className="text-body-sm font-semibold">Comentario</p>
                <p className="text-body-sm whitespace-pre-wrap">{data.comment}</p>
              </div>
            )}
            {canDecide && (
              <div className="grid gap-2">
                <Label htmlFor="approval-comment">Comentario (opcional)</Label>
                <Textarea
                  id="approval-comment"
                  value={comment}
                  maxLength={COMMENT_MAX}
                  onChange={(event) => setComment(event.target.value)}
                />
                <p className="text-body-sm text-ink-muted">
                  {comment.length}/{COMMENT_MAX}
                </p>
              </div>
            )}
            {data.status === 'pending' && !canDecide && (
              <p className="text-body-sm text-ink-muted">
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
