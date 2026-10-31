import { defaultPayloadConverter } from '@temporalio/common';
import { SENSITIVE_KEYS } from '@cognitive-dag/logger';
import type { StepIo } from '@cognitive-dag/contracts';

/** Longest JSON text of one input or output the API returns (decision 5C: content is read, not kept). */
export const MAX_IO_CHARS = 32_768;

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 20;
const SENSITIVE = SENSITIVE_KEYS.map((key) => key.toLowerCase());

const isSensitive = (key: string): boolean => {
  const normalized = key.toLowerCase().replace(/[_-]/g, '');
  return SENSITIVE.some((sensitive) => normalized.includes(sensitive));
};

/** Replaces the value of every key that looks like a credential, at any depth. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        isSensitive(key) ? REDACTED : redact(inner, depth + 1),
      ]),
    );
  }
  return value;
}

/** Redacts, then cuts the JSON text when it is too long. */
export function present(value: unknown): { value: unknown; truncated: boolean } {
  const safe = redact(value);
  const text = JSON.stringify(safe) ?? '';
  if (text.length <= MAX_IO_CHARS) return { value: safe, truncated: false };
  return { value: `${text.slice(0, MAX_IO_CHARS)}…`, truncated: true };
}

export function toStepIo(content: { input?: unknown; output?: unknown }): StepIo {
  const input = 'input' in content ? present(content.input) : undefined;
  const output = 'output' in content ? present(content.output) : undefined;
  return {
    ...(input ? { input: input.value } : {}),
    ...(output ? { output: output.value } : {}),
    truncated: Boolean(input?.truncated || output?.truncated),
  };
}

/** The part of a Temporal history event this module reads. */
interface HistoryEvent {
  eventId?: unknown;
  workflowExecutionStartedEventAttributes?: {
    input?: { payloads?: unknown[] | null } | null;
  } | null;
  activityTaskScheduledEventAttributes?: {
    activityType?: { name?: string | null } | null;
    input?: { payloads?: unknown[] | null } | null;
  } | null;
  activityTaskCompletedEventAttributes?: {
    scheduledEventId?: unknown;
    result?: { payloads?: unknown[] | null } | null;
  } | null;
}

type Payload = Parameters<typeof defaultPayloadConverter.fromPayload>[0];

const firstPayload = (box?: { payloads?: unknown[] | null } | null): unknown => {
  const payload = box?.payloads?.[0];
  return payload === undefined
    ? undefined
    : defaultPayloadConverter.fromPayload(payload as Payload);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The trigger input: the first argument of the interpreter, as the run started with it. */
export function triggerInputOf(
  events: readonly HistoryEvent[],
): Record<string, unknown> | undefined {
  const started = events.find((event) => event.workflowExecutionStartedEventAttributes);
  const input = firstPayload(started?.workflowExecutionStartedEventAttributes?.input);
  return isRecord(input) && isRecord(input['triggerInput']) ? input['triggerInput'] : undefined;
}

/** Outputs a rerun from a node was started with: the first argument of the interpreter. */
export function memoizedOf(events: readonly HistoryEvent[]): Record<string, unknown> {
  const started = events.find((event) => event.workflowExecutionStartedEventAttributes);
  const input = firstPayload(started?.workflowExecutionStartedEventAttributes?.input);
  return isRecord(input) && isRecord(input['memoized']) ? input['memoized'] : {};
}

/**
 * Input and output of one node, from the history. `trigger.manual` receives and hands on the run
 * input; `mock.service` is an activity, so its content is in its scheduled and completed events.
 * Nodes evaluated inside the workflow (conditions, merges) record no payloads.
 */
export function stepContentOf(
  events: readonly HistoryEvent[],
  node: { id: string; type: string },
): { input?: unknown; output?: unknown } {
  if (node.type === 'trigger.manual') {
    const input = triggerInputOf(events);
    return input === undefined ? {} : { input, output: input };
  }
  if (node.type !== 'mock.service') return {};

  const scheduled = events.find((event) => {
    const attrs = event.activityTaskScheduledEventAttributes;
    if (attrs?.activityType?.name !== 'mockService') return false;
    const input = firstPayload(attrs.input);
    return isRecord(input) && input['nodeId'] === node.id;
  });
  if (!scheduled) return {};
  const input = firstPayload(scheduled.activityTaskScheduledEventAttributes?.input);
  const config = isRecord(input) ? input['config'] : undefined;
  const completed = events.find(
    (event) =>
      event.activityTaskCompletedEventAttributes !== undefined &&
      event.activityTaskCompletedEventAttributes !== null &&
      String(event.activityTaskCompletedEventAttributes.scheduledEventId) ===
        String(scheduled.eventId),
  );
  const result = firstPayload(completed?.activityTaskCompletedEventAttributes?.result);
  return {
    input: { config },
    ...(isRecord(result) ? { output: result['output'] } : {}),
  };
}
