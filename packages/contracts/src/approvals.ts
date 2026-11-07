import { z } from 'zod';
import { PersonRefSchema } from './primitives.js';

export const ApprovalStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'timed_out',
  'cancelled',
]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const ApprovalDecisionSchema = z.enum(['approved', 'rejected']);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

/** Longest approval message and decision comment (F7, research R8). */
export const APPROVAL_MESSAGE_MAX = 2000;
export const APPROVAL_COMMENT_MAX = 500;

/** A request without its message: the message lives only in the Temporal history. */
export const ApprovalSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  workflowId: z.uuid(),
  workflowName: z.string(),
  nodeId: z.string(),
  nodeLabel: z.string(),
  status: ApprovalStatusSchema,
  requestedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  decidedBy: PersonRefSchema.nullable(),
  hasComment: z.boolean(),
  /** The person who asks can decide this request now. */
  canDecide: z.boolean().optional(),
});
export type Approval = z.infer<typeof ApprovalSchema>;

/** The request with the message and, once decided, the comment, both read from Temporal. */
export const ApprovalDetailSchema = ApprovalSchema.extend({
  message: z.string().max(APPROVAL_MESSAGE_MAX),
  comment: z.string().max(APPROVAL_COMMENT_MAX).nullable().optional(),
});
export type ApprovalDetail = z.infer<typeof ApprovalDetailSchema>;

export const ApprovalListSchema = z.object({
  items: z.array(ApprovalSchema),
  nextCursor: z.string().nullable(),
});
export type ApprovalList = z.infer<typeof ApprovalListSchema>;

export const ApprovalCountSchema = z.object({ pending: z.int().min(0) });
export type ApprovalCount = z.infer<typeof ApprovalCountSchema>;

export const ApprovalListQuerySchema = z.object({
  status: z.enum(['pending', 'resolved']).default('pending'),
  cursor: z.string().min(1).max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ApprovalListQuery = z.infer<typeof ApprovalListQuerySchema>;

export const DecideApprovalRequestSchema = z.strictObject({
  decision: ApprovalDecisionSchema,
  comment: z.string().max(APPROVAL_COMMENT_MAX).optional(),
});
export type DecideApprovalRequest = z.infer<typeof DecideApprovalRequestSchema>;

/** Name of the Temporal Update the API sends to decide (F7, research R7). */
export const DECIDE_APPROVAL_UPDATE_NAME = 'decideApproval';

export const DecideApprovalUpdateInputSchema = z.strictObject({
  nodeId: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  decision: ApprovalDecisionSchema,
  decidedBy: z.uuid(),
  comment: z.string().max(APPROVAL_COMMENT_MAX).optional(),
});
export type DecideApprovalUpdateInput = z.infer<typeof DecideApprovalUpdateInputSchema>;

/** Why the workflow did not take a decision; the first decision wins. */
export const DecideApprovalRefusalSchema = z.enum([
  'already_resolved',
  'not_waiting',
  'unknown_node',
]);
export type DecideApprovalRefusal = z.infer<typeof DecideApprovalRefusalSchema>;

export const DecideApprovalUpdateResultSchema = z.discriminatedUnion('accepted', [
  z.strictObject({ accepted: z.literal(true) }),
  z.strictObject({ accepted: z.literal(false), reason: DecideApprovalRefusalSchema }),
]);
export type DecideApprovalUpdateResult = z.infer<typeof DecideApprovalUpdateResultSchema>;
