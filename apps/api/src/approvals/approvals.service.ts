import { Inject, Injectable } from '@nestjs/common';
import { WorkflowNotFoundError } from '@temporalio/common';
import {
  and,
  approvals,
  desc,
  eq,
  inArray,
  lt,
  named,
  ne,
  or,
  isNull,
  sql,
  workflowRuns,
  workflows,
  type DatabaseClient,
  type Tx,
} from '@cognitive-dag/db';
import {
  DECIDE_APPROVAL_UPDATE_NAME,
  DecideApprovalUpdateResultSchema,
  type Approval,
  type ApprovalCount,
  type ApprovalDecision,
  type ApprovalDetail,
  type ApprovalList,
  type DecideApprovalUpdateInput,
} from '@cognitive-dag/contracts';
import { DomainException, ResourceNotFoundException } from '../common/errors/domain.exception';
import { DATABASE } from '../database/database.module';
import { RunTemporalService, isTemporalUnavailable } from '../runs/run-history.service';
import { userNames } from '../runs/run-mappers';
import { SecurityEventLogger } from '../security-events/security-event.logger';
import { approvalContentOf } from './approval-content';

export interface ApprovalActor {
  userId: string;
  organizationId: string;
  ip: string;
}

type ApprovalRow = typeof approvals.$inferSelect;

/** How long the answer waits for the interpreter to record the decision before it answers without it. */
const RECORD_WAIT_MS = 3_000;
const RECORD_POLL_MS = 100;

const alreadyResolved = () =>
  new DomainException(
    409,
    'APPROVAL_ALREADY_RESOLVED',
    'Esta solicitud ya fue resuelta: otra persona decidió, venció el plazo o la ejecución terminó.',
  );

/**
 * The inbox of approvals and the decision (F7, decisions 7A and 8B). The rows of `approvals` say
 * what is waiting and for whom; the message and the comment are read from the history of Temporal,
 * and the decision is an Update sent to the workflow, which is what makes "the first one wins"
 * certain: the workflow, not the database, picks the winner.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseClient,
    private readonly temporal: RunTemporalService,
    private readonly events: SecurityEventLogger,
  ) {}

  private context(actor: ApprovalActor) {
    return { userId: actor.userId, organizationId: actor.organizationId };
  }

  /** Pending requests the person can decide: not those of a run they started (7A). */
  private decidable(actor: ApprovalActor) {
    return and(
      eq(approvals.organizationId, actor.organizationId),
      eq(approvals.status, 'pending'),
      or(isNull(approvals.runTriggeredBy), ne(approvals.runTriggeredBy, actor.userId)),
    );
  }

  async list(
    actor: ApprovalActor,
    query: { status: 'pending' | 'resolved'; cursor?: string; limit: number },
  ): Promise<ApprovalList> {
    const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    return this.database.withContext(this.context(actor), async (tx) => {
      const rows = await tx
        .select()
        .from(approvals)
        .where(
          and(
            query.status === 'pending'
              ? this.decidable(actor)
              : and(
                  eq(approvals.organizationId, actor.organizationId),
                  ne(approvals.status, 'pending'),
                ),
            after === undefined ? undefined : lt(approvals.id, after),
          ),
        )
        // UUID v7: the id order is the order the requests were made, newest first.
        .orderBy(desc(approvals.id))
        .limit(query.limit + 1);
      const page = rows.slice(0, query.limit);
      const items = await this.present(tx, actor, page);
      const last = page.at(-1);
      return {
        items,
        nextCursor: rows.length > query.limit && last ? encodeCursor(last.id) : null,
      };
    });
  }

  async count(actor: ApprovalActor): Promise<ApprovalCount> {
    return this.database.withContext(this.context(actor), async (tx) => {
      const [row] = await tx
        .select({ pending: sql<number>`count(*)::int` })
        .from(approvals)
        .where(this.decidable(actor));
      return { pending: row?.pending ?? 0 };
    });
  }

  async get(actor: ApprovalActor, approvalId: string): Promise<ApprovalDetail> {
    const { row, item, temporalWorkflowId } = await this.database.withContext(
      this.context(actor),
      async (tx) => {
        const found = await this.find(tx, actor, approvalId);
        const [run] = await tx
          .select({ temporalWorkflowId: workflowRuns.temporalWorkflowId })
          .from(workflowRuns)
          .where(eq(workflowRuns.id, found.runId));
        const [presented] = await this.present(tx, actor, [found]);
        if (!run || !presented) throw new ResourceNotFoundException();
        return { row: found, item: presented, temporalWorkflowId: run.temporalWorkflowId };
      },
    );

    const expired = () =>
      new DomainException(
        410,
        'APPROVAL_CONTENT_EXPIRED',
        'El mensaje de esta solicitud ya no está disponible: el historial del motor venció.',
      );
    const history = await this.temporal.history(temporalWorkflowId);
    if (history === undefined) throw expired();
    const content = approvalContentOf(history, row.nodeId);
    if (content.message === undefined) throw expired();
    return {
      ...item,
      message: content.message,
      ...(row.hasComment ? { comment: content.comment } : { comment: null }),
    };
  }

  async decide(
    actor: ApprovalActor,
    approvalId: string,
    decision: ApprovalDecision,
    comment: string | undefined,
  ): Promise<Approval> {
    const { row, temporalWorkflowId } = await this.database.withContext(
      this.context(actor),
      async (tx) => {
        const found = await this.find(tx, actor, approvalId);
        // 7A: who started the run does not approve its own request. The database repeats the rule.
        if (found.runTriggeredBy === actor.userId) {
          throw new DomainException(
            403,
            'APPROVAL_SELF_DECISION_FORBIDDEN',
            'No puedes decidir una solicitud de una ejecución que iniciaste tú.',
          );
        }
        if (found.status !== 'pending') throw alreadyResolved();
        const [run] = await tx
          .select({ temporalWorkflowId: workflowRuns.temporalWorkflowId })
          .from(workflowRuns)
          .where(eq(workflowRuns.id, found.runId));
        if (!run) throw new ResourceNotFoundException();
        return { row: found, temporalWorkflowId: run.temporalWorkflowId };
      },
    );

    const input: DecideApprovalUpdateInput = {
      nodeId: row.nodeId,
      decision,
      decidedBy: actor.userId,
      ...(comment === undefined || comment === '' ? {} : { comment }),
    };
    let result: unknown;
    try {
      result = await this.temporal.withDeadline(() =>
        this.temporal.client.workflow
          .getHandle(temporalWorkflowId)
          .executeUpdate(DECIDE_APPROVAL_UPDATE_NAME, { args: [input] }),
      );
    } catch (error) {
      if (isTemporalUnavailable(error)) throw this.temporal.translate(error);
      // The workflow already closed (finished, timed out, cancelled): nothing is left to decide.
      if (error instanceof WorkflowNotFoundError || isWorkflowClosed(error))
        throw alreadyResolved();
      throw error;
    }
    const parsed = DecideApprovalUpdateResultSchema.safeParse(result);
    if (!parsed.success) throw new Error('The decideApproval Update returned an unexpected result');
    if (!parsed.data.accepted) throw alreadyResolved();

    this.events.emit({
      event: 'approval.decided',
      outcome: 'success',
      userId: actor.userId,
      organizationId: actor.organizationId,
      ip: actor.ip,
      resourceId: approvalId,
    });
    return this.afterDecision(actor, approvalId, decision);
  }

  /** The interpreter records the decision a moment after the Update returns; wait for it briefly. */
  private async afterDecision(
    actor: ApprovalActor,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<Approval> {
    const deadline = Date.now() + RECORD_WAIT_MS;
    for (;;) {
      const current = await this.database.withContext(this.context(actor), async (tx) => {
        const row = await this.find(tx, actor, approvalId);
        const [item] = await this.present(tx, actor, [row]);
        return item;
      });
      if (current && current.status !== 'pending') return current;
      if (Date.now() > deadline) {
        // Accepted by the workflow, not yet written to the row: answer with what is already true.
        const names = await this.database.withContext(this.context(actor), (tx) =>
          userNames(tx, [actor.userId]),
        );
        return {
          ...(current as Approval),
          status: decision,
          resolvedAt: new Date().toISOString(),
          decidedBy: { id: actor.userId, name: names.get(actor.userId) ?? 'Usuario desconocido' },
          canDecide: false,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, RECORD_POLL_MS));
    }
  }

  private async find(tx: Tx, actor: ApprovalActor, approvalId: string): Promise<ApprovalRow> {
    const [row] = await tx
      .select()
      .from(approvals)
      .where(and(eq(approvals.id, approvalId), eq(approvals.organizationId, actor.organizationId)));
    if (!row) throw new ResourceNotFoundException();
    return row;
  }

  private async present(tx: Tx, actor: ApprovalActor, rows: ApprovalRow[]): Promise<Approval[]> {
    if (rows.length === 0) return [];
    const people = await userNames(
      tx,
      rows.map((row) => row.decidedBy),
    );
    const workflowRows = await named.workflows(
      tx,
      inArray(workflows.id, [...new Set(rows.map((row) => row.workflowId))]),
    );
    const workflowNames = new Map(workflowRows.map((workflow) => [workflow.id, workflow.name]));
    return rows.map((row) => ({
      id: row.id,
      runId: row.runId,
      workflowId: row.workflowId,
      workflowName: workflowNames.get(row.workflowId) ?? '',
      nodeId: row.nodeId,
      nodeLabel: row.nodeLabel,
      status: row.status,
      requestedAt: row.requestedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      decidedBy:
        row.decidedBy === null
          ? null
          : { id: row.decidedBy, name: people.get(row.decidedBy) ?? 'Usuario desconocido' },
      hasComment: row.hasComment,
      canDecide: row.status === 'pending' && row.runTriggeredBy !== actor.userId,
    }));
  }
}

/** Temporal answers an Update to a closed workflow with an error that only names it in the message. */
function isWorkflowClosed(error: unknown): boolean {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if (
      /already completed|workflow execution (is )?(already )?(closed|completed)/i.test(
        current.message,
      )
    ) {
      return true;
    }
  }
  return false;
}

const encodeCursor = (id: string): string => Buffer.from(id, 'utf8').toString('base64url');

function decodeCursor(cursor: string): string {
  const id = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    throw new DomainException(422, 'VALIDATION_FAILED', 'La solicitud contiene datos inválidos.', {
      errors: [{ field: 'cursor', message: 'El cursor no es válido.' }],
    });
  }
  return id;
}
