import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Duration } from '@temporalio/common';
import { Worker, type NativeConnection } from '@temporalio/worker';
import { createLogger, type Logger } from '@cognitive-dag/logger';
import type { WithContext } from '@cognitive-dag/db';
import { createMockServiceActivities } from './activities/mock-service';
import { createPingActivities } from './activities/ping.activities';
import { createRunEventActivities } from './activities/record-run-event';

/** Opaque per-process id: it reaches API clients in the ping result, so it must not leak host data. */
export function createWorkerId(): string {
  return `worker-${randomUUID()}`;
}

/** What the run-recording activity needs: Postgres as app_runtime and a Valkey publisher. */
export interface RunRecordingOptions {
  withContext: WithContext;
  publish(channel: string, message: string): Promise<unknown>;
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
      ...createMockServiceActivities({ logger }),
      ...(options.runs ? createRunEventActivities({ ...options.runs, logger }) : {}),
    },
    ...(options.shutdownGraceTime === undefined
      ? {}
      : { shutdownGraceTime: options.shutdownGraceTime }),
  });
}
