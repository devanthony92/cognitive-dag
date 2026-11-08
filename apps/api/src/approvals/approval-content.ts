import { defaultPayloadConverter } from '@temporalio/common';

type Payload = Parameters<typeof defaultPayloadConverter.fromPayload>[0];
type PayloadBox = { payloads?: unknown[] | null } | null | undefined;

interface UpdateMeta {
  updateId?: string | null;
}

/** The part of a Temporal history event this module reads. */
export interface ApprovalHistoryEvent {
  activityTaskScheduledEventAttributes?: {
    activityType?: { name?: string | null } | null;
    input?: PayloadBox;
  } | null;
  workflowExecutionUpdateAcceptedEventAttributes?: {
    acceptedRequest?: {
      meta?: UpdateMeta | null;
      input?: { name?: string | null; args?: PayloadBox } | null;
    } | null;
  } | null;
  workflowExecutionUpdateCompletedEventAttributes?: {
    meta?: UpdateMeta | null;
    outcome?: { success?: PayloadBox } | null;
  } | null;
}

const first = (box: PayloadBox): unknown => {
  const payload = box?.payloads?.[0];
  return payload === undefined
    ? undefined
    : defaultPayloadConverter.fromPayload(payload as Payload);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export interface ApprovalContent {
  message: string | undefined;
  comment: string | null;
}

/**
 * What PostgreSQL never keeps (decision 5C): the message of the approval node, recorded as an input
 * of its `notifyApprovers` activity, and the comment of the decision, recorded as the argument of the
 * Update that took it. Among the Updates for the node, the one whose result was `accepted: true`
 * is the decision; the ones refused for coming late left no comment worth showing.
 */
export function approvalContentOf(
  events: readonly ApprovalHistoryEvent[],
  nodeId: string,
): ApprovalContent {
  let message: string | undefined;
  for (const event of events) {
    const attrs = event.activityTaskScheduledEventAttributes;
    if (attrs?.activityType?.name !== 'notifyApprovers') continue;
    const input = first(attrs.input);
    if (isRecord(input) && input['nodeId'] === nodeId && typeof input['message'] === 'string') {
      message = input['message'];
      break;
    }
  }

  const accepted = new Set<string>();
  for (const event of events) {
    const completed = event.workflowExecutionUpdateCompletedEventAttributes;
    const result = first(completed?.outcome?.success);
    const id = completed?.meta?.updateId;
    if (id && isRecord(result) && result['accepted'] === true) accepted.add(id);
  }
  let comment: string | null = null;
  for (const event of events) {
    const request = event.workflowExecutionUpdateAcceptedEventAttributes?.acceptedRequest;
    const id = request?.meta?.updateId;
    if (!id || !accepted.has(id) || request?.input?.name !== 'decideApproval') continue;
    const args = first(request.input.args);
    if (isRecord(args) && args['nodeId'] === nodeId) {
      comment =
        typeof args['comment'] === 'string' && args['comment'] !== '' ? args['comment'] : null;
      break;
    }
  }
  return { message, comment };
}
