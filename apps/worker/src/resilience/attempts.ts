import { ApplicationFailure, CancelledFailure, Context } from '@temporalio/activity';
import {
  ERROR_CLASS_CODES,
  backoffDelayMs,
  classify,
  isRetryable,
  type ErrorClass,
  type RetryPolicy,
} from '@cognitive-dag/dag-schema';

/** Policy of the node as the interpreter passes it to the activity. */
export type AttemptPolicy = RetryPolicy;

/** A failure of a node, already in the taxonomy (FR-003): nodes with effects throw only these. */
export class NodeFailure extends Error {
  readonly errorClass: ErrorClass;
  readonly code: string;
  /** How long the service asked to wait before the next attempt (limited failures). */
  readonly retryAfterMs: number | undefined;

  constructor(options: {
    errorClass: ErrorClass;
    code?: string;
    message: string;
    retryAfterMs?: number;
  }) {
    super(options.message);
    this.name = 'NodeFailure';
    this.errorClass = options.errorClass;
    this.code = options.code ?? ERROR_CLASS_CODES[options.errorClass];
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** Code of the failure that ends a node whose attempts kept running out of time. */
export const TIMED_OUT_CODE = 'ACTIVITY_TIMED_OUT';

/**
 * What the activity remembers from one attempt to the next, in its heartbeat details (research
 * R3). Temporal retries without limit, so the policy of the node is applied here: only failures
 * that are not `rate_limited` spend attempts, and waiting for the rate limit never does.
 */
interface AttemptState {
  /** Attempts that count against `maxAttempts`, before the one in flight. */
  spent: number;
  /** Attempts that reached the effect (a wait for the rate limit is not one). */
  executed: number;
  /** The last attempt started and did not report how it ended (timeout, crash). */
  inFlight: boolean;
  /** The step is marked as waiting for the rate limit. */
  waiting: boolean;
}

const INITIAL_STATE: AttemptState = { spent: 0, executed: 0, inFlight: false, waiting: false };

function readState(details: unknown): AttemptState {
  if (typeof details !== 'object' || details === null) return INITIAL_STATE;
  const raw = details as Record<string, unknown>;
  const count = (value: unknown): number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
  return {
    spent: count(raw['spent']),
    executed: count(raw['executed']),
    inFlight: raw['inFlight'] === true,
    waiting: raw['waiting'] === true,
  };
}

/** Details attached to a failure so the interpreter can record the attempts and the class. */
export interface FailureDetails {
  attempt: number;
  errorClass: ErrorClass;
}

const UNEXPECTED_MESSAGE = 'The node failed with an unexpected error.';

/** Puts any error into the taxonomy; what nothing explains is transient (FR-002). */
export function toNodeFailure(error: unknown): NodeFailure {
  if (error instanceof NodeFailure) return error;
  if (error instanceof ApplicationFailure) {
    const declared = (error.details?.[0] as { errorClass?: unknown } | undefined)?.errorClass;
    const errorClass = classify({ errorClass: declared, nonRetryable: error.nonRetryable });
    return new NodeFailure({
      errorClass,
      code: error.type ?? ERROR_CLASS_CODES[errorClass],
      message: error.message,
    });
  }
  return new NodeFailure({ errorClass: 'transient', message: UNEXPECTED_MESSAGE });
}

/** The failure Temporal sees, with the class and the attempt in its details. */
export function toApplicationFailure(
  failure: NodeFailure,
  options: { attempt: number; nonRetryable?: boolean; nextRetryDelayMs?: number },
): ApplicationFailure {
  const details: FailureDetails = { attempt: options.attempt, errorClass: failure.errorClass };
  return ApplicationFailure.create({
    type: failure.code,
    message: failure.message,
    nonRetryable: options.nonRetryable ?? !isRetryable(failure.errorClass),
    ...(options.nextRetryDelayMs === undefined ? {} : { nextRetryDelay: options.nextRetryDelayMs }),
    details: [details],
  });
}

export interface AttemptNumbers {
  /** This attempt among those that reached the effect, from 1. */
  executed: number;
  /** This attempt among those that count against `maxAttempts`, from 1. */
  spent: number;
}

export interface PolicyRun<T> {
  policy: AttemptPolicy;
  /**
   * Runs before the effect and may deny the attempt with a `rate_limited` failure. `waiting` says
   * the previous attempt was denied, so a mark of the step can be cleared.
   */
  gate?: (state: { waiting: boolean }) => Promise<void>;
  body: (attempt: AttemptNumbers) => Promise<T>;
  /** Source of randomness for the jitter of the waits; replaced in tests. */
  random?: () => number;
}

function isCancellation(error: unknown): boolean {
  if (error instanceof CancelledFailure) return true;
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'AbortError' || Context.current().cancellationSignal.aborted;
}

/**
 * Runs one attempt of a node under its policy (FR-002, FR-005, research R3):
 * transient and timeout failures retry with a growing wait up to `maxAttempts`; a limited failure
 * waits what it asked without spending an attempt; a permanent one never retries.
 */
export async function runWithPolicy<T>(run: PolicyRun<T>): Promise<T> {
  const context = Context.current();
  const { policy } = run;
  const previous = readState(context.info.heartbeatDetails);
  // An attempt that was in flight and never reported (timeout, crash) counts as spent.
  const spentBefore = previous.spent + (previous.inFlight ? 1 : 0);
  let executed = previous.executed;

  if (spentBefore >= policy.maxAttempts) {
    throw toApplicationFailure(
      new NodeFailure({
        errorClass: 'timeout',
        code: TIMED_OUT_CODE,
        message: 'The node exceeded its time limit.',
      }),
      { attempt: executed, nonRetryable: true },
    );
  }

  const remember = (state: Partial<AttemptState>): void =>
    context.heartbeat({ spent: spentBefore, executed, inFlight: false, waiting: false, ...state });
  // Optimistic: a worker that dies later must still leave this attempt counted. Only the first
  // heartbeat is certain to reach Temporal, and a denied attempt takes the count back below.
  remember({ inFlight: true, executed: executed + 1 });

  try {
    await run.gate?.({ waiting: previous.waiting });
    executed += 1;
    return await run.body({ executed, spent: spentBefore + 1 });
  } catch (error) {
    if (isCancellation(error)) throw error;
    const failure = toNodeFailure(error);

    if (failure.errorClass === 'rate_limited') {
      remember({ waiting: true });
      throw toApplicationFailure(failure, {
        attempt: executed,
        nextRetryDelayMs: failure.retryAfterMs ?? policy.initialIntervalMs,
      });
    }

    const spent = spentBefore + 1;
    remember({ spent, executed });
    const lastAttempt = spent >= policy.maxAttempts;
    if (!isRetryable(failure.errorClass) || lastAttempt) {
      throw toApplicationFailure(failure, { attempt: executed, nonRetryable: true });
    }
    throw toApplicationFailure(failure, {
      attempt: executed,
      nonRetryable: false,
      nextRetryDelayMs: backoffDelayMs(spent, policy.initialIntervalMs, run.random),
    });
  }
}
