import { setTimeout as sleep } from 'node:timers/promises';
import { ApplicationFailure, Context } from '@temporalio/activity';
import type { Logger } from '@cognitive-dag/logger';

export interface MockServiceInput {
  runId: string;
  nodeId: string;
  correlationId: string;
  config: {
    latencyMs: number;
    failureRate: number;
    failureKind: 'transient' | 'permanent' | 'timeout';
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

export interface MockServiceOptions {
  logger: Logger;
  /** Source of randomness for `failureRate`; replaced in tests. */
  random?: () => number;
  /** How long a `timeout` failure hangs: longer than the activity timeout so Temporal gives up. */
  timeoutHangMs?: number;
}

export const MOCK_SERVICE_ERROR_TYPES = {
  transient: 'MOCK_SERVICE_TRANSIENT',
  permanent: 'MOCK_SERVICE_PERMANENT',
} as const;

const DEFAULT_TIMEOUT_HANG_MS = 35_000;

/**
 * The simulated service (FR-008): waits `latencyMs`, then fails with probability `failureRate`
 * as configured. A transient failure is retried by Temporal, a permanent one is not, and a
 * `timeout` hangs past the activity timeout. It honours cancellation while waiting.
 */
export function createMockServiceActivities(options: MockServiceOptions): MockServiceActivities {
  const random = options.random ?? Math.random;
  const hangMs = options.timeoutHangMs ?? DEFAULT_TIMEOUT_HANG_MS;

  return {
    async mockService(input) {
      const { attempt } = Context.current().info;
      const signal = Context.current().cancellationSignal;
      const log = options.logger.child({
        correlationId: input.correlationId,
        runId: input.runId,
        nodeId: input.nodeId,
      });
      log.info({ attempt }, 'Mock service started');

      if (input.config.latencyMs > 0) await sleep(input.config.latencyMs, undefined, { signal });

      if (input.config.failureRate > 0 && random() < input.config.failureRate) {
        log.warn({ attempt, failureKind: input.config.failureKind }, 'Mock service failing');
        const { failureKind } = input.config;
        if (failureKind === 'timeout') await sleep(hangMs, undefined, { signal });
        const details: MockServiceFailureDetails = { attempt };
        throw ApplicationFailure.create({
          type: MOCK_SERVICE_ERROR_TYPES[failureKind === 'permanent' ? 'permanent' : 'transient'],
          message: `The simulated service failed (${failureKind}).`,
          nonRetryable: failureKind === 'permanent',
          details: [details],
        });
      }

      log.info({ attempt }, 'Mock service finished');
      return { output: { ok: true }, attempts: attempt };
    },
  };
}
