import { setTimeout as sleep } from 'node:timers/promises';
import { Context } from '@temporalio/activity';
import { ERROR_CLASS_CODES } from '@cognitive-dag/dag-schema';
import type { Logger } from '@cognitive-dag/logger';
import {
  NodeFailure,
  heartbeatWithState,
  runWithPolicy,
  toApplicationFailure,
  toNodeFailure,
  type AttemptPolicy,
} from '../resilience/attempts';
import {
  runIdempotentEffect,
  type EffectDestination,
  type EffectStore,
} from '../resilience/effects';
import type { RateLimiter } from '../resilience/rate-limiter';

export interface MockServiceInput {
  runId: string;
  nodeId: string;
  correlationId: string;
  /** Needed to limit the rate and register the effect; runs started before F4 do not carry it. */
  organizationId?: string;
  /** Effective policy of the node; without it the activity runs as it did before F4. */
  policy?: AttemptPolicy;
  config: {
    latencyMs: number;
    failureRate: number;
    failureKind: 'transient' | 'permanent' | 'timeout' | 'rate_limited';
    /** Wait a `rate_limited` failure asks for. */
    retryAfterMs?: number;
    /** Fails this many attempts and then works, without chance. Wins over `failureRate`. */
    failFirstAttempts?: number;
  };
}

export interface MockServiceResult {
  output: { ok: boolean };
  /** Attempt of the activity that produced the result, for the step record. */
  attempts: number;
}

/** Details attached to a failure so the interpreter can record the attempts that were made. */
export interface MockServiceFailureDetails {
  attempt: number;
}

export interface MockServiceActivities {
  mockService(input: MockServiceInput): Promise<MockServiceResult>;
}

/** The step starts or stops waiting for the rate limit (`null`). */
export interface WaitingMark {
  organizationId: string;
  runId: string;
  correlationId: string;
  nodeId: string;
  waitingReason: 'rate_limited' | null;
}

export interface MockServiceOptions {
  logger: Logger;
  /** Source of randomness for `failureRate`; replaced in tests. */
  random?: () => number;
  /** How long a `timeout` failure hangs: longer than the activity timeout so Temporal gives up. */
  timeoutHangMs?: number;
  /** Token bucket of the node type; without it the node is not limited. */
  rateLimiter?: RateLimiter;
  /** Records the effect so it is not repeated; without it the effect is not recorded. */
  effects?: EffectStore;
  /** Where the effect lands; the simulated destination applies each key once. */
  destination?: EffectDestination;
  /** Marks the step as waiting for the rate limit, and clears the mark. */
  markWaiting?: (mark: WaitingMark) => Promise<void>;
}

export const MOCK_SERVICE_ERROR_TYPES = {
  transient: 'MOCK_SERVICE_TRANSIENT',
  permanent: 'MOCK_SERVICE_PERMANENT',
  rate_limited: 'MOCK_SERVICE_RATE_LIMITED',
} as const;

const DEFAULT_TIMEOUT_HANG_MS = 35_000;

/** A hang that outlasts the time per attempt of the policy, so Temporal gives up first. */
const HANG_MARGIN_MS = 5_000;

/** Heartbeat period: lets Temporal notice a dead worker fast and deliver a cancellation. */
const HEARTBEAT_EVERY_MS = 2_000;

/** Waits `ms` while heartbeating, and stops with the abort of the activity cancellation. */
async function waitWithHeartbeat(ms: number, signal: AbortSignal): Promise<void> {
  const end = Date.now() + ms;
  for (let left = ms; left > 0; left = end - Date.now()) {
    heartbeatWithState();
    await sleep(Math.min(left, HEARTBEAT_EVERY_MS), undefined, { signal });
  }
}

/**
 * The simulated service (FR-008, FR-013, FR-014): waits `latencyMs`, then fails as configured: by
 * chance (`failureRate`) or without it, the first N attempts (`failFirstAttempts`). A transient
 * failure is retried, a permanent one is not, a limited one waits what it asks, and a `timeout`
 * hangs past the activity timeout. It honours cancellation while waiting.
 *
 * Under a policy (F4) it also asks the token bucket for capacity before the effect, records the
 * effect so a retry or a recovery does not repeat it, and counts its own attempts so that waiting
 * for the rate limit never spends them (research R3, R4).
 */
export function createMockServiceActivities(options: MockServiceOptions): MockServiceActivities {
  const random = options.random ?? Math.random;

  return {
    async mockService(input) {
      const context = Context.current();
      const signal = context.cancellationSignal;
      const log = options.logger.child({
        correlationId: input.correlationId,
        runId: input.runId,
        nodeId: input.nodeId,
      });
      const { config, organizationId } = input;
      const hangMs =
        options.timeoutHangMs ??
        (input.policy
          ? input.policy.timeoutSeconds * 1000 + HANG_MARGIN_MS
          : DEFAULT_TIMEOUT_HANG_MS);

      const markWaiting = async (waitingReason: WaitingMark['waitingReason']): Promise<void> => {
        if (!options.markWaiting || !organizationId) return;
        try {
          await options.markWaiting({
            organizationId,
            runId: input.runId,
            correlationId: input.correlationId,
            nodeId: input.nodeId,
            waitingReason,
          });
        } catch (error) {
          // The mark is informative; a lost one must not fail the node.
          log.warn({ err: error }, 'Could not mark the step as waiting');
        }
      };

      /** Takes a token before the effect (FR-008); without capacity the attempt is rescheduled. */
      const gate = async ({ waiting }: { waiting: boolean }): Promise<void> => {
        if (!options.rateLimiter || !organizationId) return;
        let decision;
        try {
          decision = await options.rateLimiter.acquire(organizationId, 'mock.service');
        } catch (error) {
          log.warn({ err: error }, 'The rate limit store is not available');
          throw new NodeFailure({
            errorClass: 'transient',
            code: 'RATE_LIMIT_UNAVAILABLE',
            message: 'The rate limit store is not available.',
          });
        }
        if (!decision.granted) {
          log.info({ retryAfterMs: decision.retryAfterMs }, 'Waiting for the rate limit');
          await markWaiting('rate_limited');
          throw new NodeFailure({
            errorClass: 'rate_limited',
            code: ERROR_CLASS_CODES.rate_limited,
            message: 'The node is waiting for its turn under the rate limit.',
            retryAfterMs: decision.retryAfterMs,
          });
        }
        if (waiting) await markWaiting(null);
      };

      /** One attempt of the service; `key` is what the destination deduplicates by. */
      const callService = async (executed: number, key?: string): Promise<void> => {
        if (config.latencyMs > 0) await waitWithHeartbeat(config.latencyMs, signal);

        const failFirst = config.failFirstAttempts ?? 0;
        const fails =
          failFirst > 0
            ? executed <= failFirst
            : config.failureRate > 0 && random() < config.failureRate;
        if (fails) {
          const { failureKind } = config;
          log.warn({ attempt: executed, failureKind }, 'Mock service failing');
          if (failureKind === 'timeout') await waitWithHeartbeat(hangMs, signal);
          throw new NodeFailure({
            errorClass: failureKind === 'timeout' ? 'timeout' : failureKind,
            code: MOCK_SERVICE_ERROR_TYPES[failureKind === 'timeout' ? 'transient' : failureKind],
            message: `The simulated service failed (${failureKind}).`,
            ...(failureKind === 'rate_limited' ? { retryAfterMs: config.retryAfterMs ?? 0 } : {}),
          });
        }

        if (key !== undefined && options.destination) {
          try {
            await options.destination.register(key);
          } catch (error) {
            log.warn({ err: error }, 'The destination is not available');
            throw new NodeFailure({
              errorClass: 'transient',
              code: 'DESTINATION_UNAVAILABLE',
              message: 'The destination of the effect is not available.',
            });
          }
        }
      };

      const attempt = async (executed: number): Promise<MockServiceResult> => {
        log.info({ attempt: executed }, 'Mock service started');
        const { effects } = options;
        if (effects && organizationId) {
          const ref = { organizationId, runId: input.runId, nodeId: input.nodeId };
          const unavailable = (error: unknown): never => {
            if (error instanceof NodeFailure) throw error;
            log.warn({ err: error }, 'The effect store is not available');
            throw new NodeFailure({
              errorClass: 'transient',
              code: 'EFFECT_STORE_UNAVAILABLE',
              message: 'The effect store is not available.',
            });
          };
          const outcome = await runIdempotentEffect({
            store: {
              begin: (r) => effects.begin(r).catch(unavailable),
              commit: (r) => effects.commit(r).catch(unavailable),
            },
            ref,
            execute: (key) => callService(executed, key),
          });
          if (outcome.replayed) log.info('Effect already committed, not repeated');
          log.info({ attempt: executed }, 'Mock service finished');
          return { output: { ok: true }, attempts: executed };
        }
        await callService(executed);
        log.info({ attempt: executed }, 'Mock service finished');
        return { output: { ok: true }, attempts: executed };
      };

      if (input.policy) {
        return runWithPolicy({
          policy: input.policy,
          gate,
          body: ({ executed }) => attempt(executed),
          random,
        });
      }
      // Runs started before F4: Temporal counts the attempts and owns the retries.
      const { attempt: temporalAttempt } = context.info;
      try {
        return await attempt(temporalAttempt);
      } catch (error) {
        if (signal.aborted) throw error;
        const failure = toNodeFailure(error);
        throw toApplicationFailure(failure, {
          attempt: temporalAttempt,
          ...(failure.errorClass === 'rate_limited' && failure.retryAfterMs !== undefined
            ? { nextRetryDelayMs: failure.retryAfterMs }
            : {}),
        });
      }
    },
  };
}
