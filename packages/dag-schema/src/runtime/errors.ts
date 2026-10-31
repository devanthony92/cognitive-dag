/**
 * Taxonomy of node failures (research R1). Pure: the interpreter and the nodes with effects
 * share it, so a failure means the same thing wherever it is read.
 */
export const ERROR_CLASSES = ['transient', 'rate_limited', 'timeout', 'permanent'] as const;

export type ErrorClass = (typeof ERROR_CLASSES)[number];

/** Code used when a failure of the class has no more specific one. */
export const ERROR_CLASS_CODES: Readonly<Record<ErrorClass, string>> = {
  transient: 'NODE_TRANSIENT',
  rate_limited: 'NODE_RATE_LIMITED',
  timeout: 'NODE_TIMEOUT',
  permanent: 'NODE_PERMANENT',
};

export function isErrorClass(value: unknown): value is ErrorClass {
  return typeof value === 'string' && (ERROR_CLASSES as readonly string[]).includes(value);
}

/** Everything but a permanent failure can succeed if tried again (FR-002). */
export function isRetryable(errorClass: ErrorClass): boolean {
  return errorClass !== 'permanent';
}

/** What the interpreter knows about a failure; the node says its class, the engine the rest. */
export interface FailureSignal {
  /** Class declared by the node that failed. */
  errorClass?: unknown;
  /** The engine gave up waiting for the node. */
  timedOut?: boolean;
  /** The failure was marked as not retryable. */
  nonRetryable?: boolean | null;
}

/** Class of a failure. What nothing explains is treated as transient: trying again is safe. */
export function classify(signal: FailureSignal): ErrorClass {
  if (isErrorClass(signal.errorClass)) return signal.errorClass;
  if (signal.timedOut) return 'timeout';
  if (signal.nonRetryable) return 'permanent';
  return 'transient';
}

/** Ceiling of the wait between two attempts of a transient failure. */
export const MAX_BACKOFF_MS = 30_000;

/** Largest relative change the random jitter applies to a wait. */
const JITTER = 0.2;

/**
 * Wait before the next attempt after `failures` failed attempts: exponential (×2) from the initial
 * interval, with ±20 % of random variation so that nodes failing together do not retry together.
 */
export function backoffDelayMs(
  failures: number,
  initialIntervalMs: number,
  random: () => number = Math.random,
): number {
  const exponential = initialIntervalMs * 2 ** Math.max(0, failures - 1);
  const factor = 1 - JITTER + random() * 2 * JITTER;
  return Math.min(Math.round(exponential * factor), MAX_BACKOFF_MS);
}
