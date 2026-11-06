import { defaultPayloadConverter } from '@temporalio/common';
import { CompileIntentResultSchema, type CompileIntentResult } from '@cognitive-dag/contracts';

/** The part of a Temporal history event this module reads. */
interface HistoryEvent {
  workflowExecutionCompletedEventAttributes?: {
    result?: { payloads?: unknown[] | null } | null;
  } | null;
}

type Payload = Parameters<typeof defaultPayloadConverter.fromPayload>[0];

/** What the history of a `compile-<id>` workflow says about its end. */
export type CompilationOutcome =
  { kind: 'running' } | { kind: 'finished'; value: CompileIntentResult } | { kind: 'unreadable' };

/**
 * The value `compileIntent` returned (research R2: the content lives only in the history). A
 * history without a completion event is a workflow that has not ended; one whose value does not
 * match the contract is unreadable and is never passed on.
 */
export function outcomeOf(events: readonly HistoryEvent[]): CompilationOutcome {
  const completed = events.find((event) => event.workflowExecutionCompletedEventAttributes);
  if (!completed) return { kind: 'running' };
  const payload = completed.workflowExecutionCompletedEventAttributes?.result?.payloads?.[0];
  if (payload === undefined) return { kind: 'unreadable' };
  const parsed = CompileIntentResultSchema.safeParse(
    defaultPayloadConverter.fromPayload(payload as Payload),
  );
  return parsed.success ? { kind: 'finished', value: parsed.data } : { kind: 'unreadable' };
}
