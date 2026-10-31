import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Duration } from '@temporalio/common';
import type Valkey from 'iovalkey';
import { Worker, type NativeConnection } from '@temporalio/worker';
import { createLogger, type Logger } from '@cognitive-dag/logger';
import type { WithContext } from '@cognitive-dag/db';
import { createMockServiceActivities } from './activities/mock-service';
import { createPingActivities } from './activities/ping.activities';
import { createRunEventActivities } from './activities/record-run-event';
import { createEffectStore, createMockDestination } from './resilience/effects';
import type { RateLimits } from './resilience/rate-limit-config';
import { createRateLimiter } from './resilience/rate-limiter';

/** Opaque per-process id: it reaches API clients in the ping result, so it must not leak host data. */
export function createWorkerId(): string {
  return `worker-${randomUUID()}`;
}

/** What the run-recording activity needs: Postgres as app_runtime and a Valkey publisher. */
export interface RunRecordingOptions {
  withContext: WithContext;
  publish(channel: string, message: string): Promise<unknown>;
  /** Valkey client for the token bucket and the simulated destination of the effects. */
  valkey?: Valkey;
  /** Token bucket by node type (`RATE_LIMIT_<NODE_TYPE>`). */
  rateLimits?: RateLimits;
}

export interface WorkerOptions {
  connection: NativeConnection;
  namespace: string;
  taskQueue: string;
  workerId: string;
  activityDelayMs: number;
  nodeEnv: string;
  logLevel?: string;
  /** Overrides the default stdout logger (tests capture activity logs with it). */
  logger?: Logger;
  shutdownGraceTime?: Duration;
  /** Without it the worker still runs the ping and `mockService`, but cannot record runs. */
  runs?: RunRecordingOptions;
}

/** Builds the worker (ping and execution engine); shared by main.ts and the integration tests. */
export function createWorker(options: WorkerOptions): Promise<Worker> {
  const logger =
    options.logger ?? createLogger({ component: 'worker', level: options.logLevel ?? 'warn' });
  const recorder = options.runs ? createRunEventActivities({ ...options.runs, logger }) : undefined;
  const resilience = options.runs?.valkey
    ? {
        rateLimiter: createRateLimiter({
          valkey: options.runs.valkey,
          limits: options.runs.rateLimits ?? {},
        }),
        effects: createEffectStore(options.runs.withContext),
        destination: createMockDestination(options.runs.valkey),
      }
    : {};
  return Worker.create({
    connection: options.connection,
    namespace: options.namespace,
    taskQueue: options.taskQueue,
    workflowsPath: path.resolve(__dirname, 'workflows'),
    activities: {
      ...createPingActivities({
        workerId: options.workerId,
        delayMs: options.activityDelayMs,
        nodeEnv: options.nodeEnv,
        logger,
      }),
      ...createMockServiceActivities({
        logger,
        ...resilience,
        ...(recorder
          ? {
              markWaiting: (mark) =>
                recorder.recordRunEvent({
                  organizationId: mark.organizationId,
                  runId: mark.runId,
                  correlationId: mark.correlationId,
                  at: new Date().toISOString(),
                  transition: 'step.running',
                  nodeId: mark.nodeId,
                  nodeType: 'mock.service',
                  ...(mark.waitingReason ? { waitingReason: mark.waitingReason } : {}),
                }),
            }
          : {}),
      }),
      ...(recorder ?? {}),
    },
    ...(options.shutdownGraceTime === undefined
      ? {}
      : { shutdownGraceTime: options.shutdownGraceTime }),
  });
}
