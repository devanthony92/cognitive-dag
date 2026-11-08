import {
  and,
  approvals,
  asc,
  eq,
  inArray,
  isNull,
  memberships,
  ne,
  users,
  workflows,
  type WithContext,
} from '@cognitive-dag/db';
import type { Logger } from '@cognitive-dag/logger';
import { approvalRequestedEmail, type Mailer } from './mail';

export interface NotifyApproversInput {
  organizationId: string;
  runId: string;
  nodeId: string;
  correlationId: string;
  /**
   * The resolved message of the approval. The activity ignores it: it is here so the message is
   * recorded in the Temporal history, where the API reads it (decision 5C), and nowhere else.
   */
  message?: string;
}

export interface NotifyApproversResult {
  /** Emails sent; also stored in `approvals.notified_count`. */
  notified: number;
}

export interface ApprovalActivities {
  notifyApprovers(input: NotifyApproversInput): Promise<NotifyApproversResult>;
}

export interface ApprovalActivityOptions {
  withContext: WithContext;
  logger: Logger;
  mailer: Mailer;
  /** `APPROVAL_EMAIL_MAX_RECIPIENTS` (the data model caps it at 20). */
  maxRecipients: number;
  /** Origin of the web app (`APP_BASE_URL`); without it the email carries no link target. */
  appBaseUrl: string | undefined;
}

/**
 * Tells the owners and editors who can decide that an approval is waiting (decision 8B, research
 * R8). The person who started the run is left out, since they cannot decide it (7A). The message
 * of the approval is not in the email. A failure to send is thrown so Temporal retries it; the
 * interpreter treats the activity as best effort and never fails the run because of it.
 */
export function createApprovalActivities(options: ApprovalActivityOptions): ApprovalActivities {
  const max = Math.min(options.maxRecipients, 20);

  return {
    async notifyApprovers(input) {
      const log = options.logger.child({
        correlationId: input.correlationId,
        runId: input.runId,
        nodeId: input.nodeId,
      });
      const context = { organizationId: input.organizationId };

      const found = await options.withContext(context, async (tx) => {
        const [approval] = await tx
          .select({
            id: approvals.id,
            status: approvals.status,
            nodeLabel: approvals.nodeLabel,
            expiresAt: approvals.expiresAt,
            runTriggeredBy: approvals.runTriggeredBy,
            notifiedCount: approvals.notifiedCount,
            workflowId: approvals.workflowId,
          })
          .from(approvals)
          .where(and(eq(approvals.runId, input.runId), eq(approvals.nodeId, input.nodeId)));
        if (!approval || approval.status !== 'pending' || approval.notifiedCount > 0) {
          return undefined;
        }
        const [workflow] = await tx
          .select({ name: workflows.name })
          .from(workflows)
          .where(eq(workflows.id, approval.workflowId));
        const recipients = await tx
          .select({ email: users.email })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(
            and(
              eq(memberships.organizationId, input.organizationId),
              isNull(memberships.deletedAt),
              isNull(users.deletedAt),
              inArray(memberships.role, ['owner', 'editor']),
              approval.runTriggeredBy === null ? undefined : ne(users.id, approval.runTriggeredBy),
            ),
          )
          .orderBy(asc(memberships.createdAt))
          .limit(max);
        return { approval, workflowName: workflow?.name ?? '', recipients };
      });
      // Already notified (a retry after a partial send) or no longer pending: nothing to send.
      if (!found) return { notified: 0 };

      const url = options.appBaseUrl
        ? `${options.appBaseUrl.replace(/\/$/, '')}/orgs/${input.organizationId}/approvals?approval=${found.approval.id}`
        : '';
      const content = approvalRequestedEmail({
        workflowName: found.workflowName,
        nodeLabel: found.approval.nodeLabel,
        expiresAt: found.approval.expiresAt,
        url,
      });

      let sent = 0;
      for (const recipient of found.recipients) {
        await options.mailer.send({
          to: recipient.email,
          ...content,
          correlationId: input.correlationId,
        });
        sent += 1;
      }

      if (sent > 0) {
        await options.withContext(context, (tx) =>
          tx
            .update(approvals)
            .set({ notifiedCount: sent })
            .where(and(eq(approvals.id, found.approval.id), eq(approvals.status, 'pending'))),
        );
      }
      log.info({ notified: sent }, 'Approvers notified');
      return { notified: sent };
    },
  };
}
