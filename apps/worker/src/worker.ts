import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Duration } from '@temporalio/common';
import { Worker, type NativeConnection } from '@temporalio/worker';
import { createLogger } from '@cognitive-dag/logger';
import { createPingActivities } from './activities/ping.activities';

/** Opaque per-process id: it reaches API clients in the ping result, so it must not leak host data. */
export function createWorkerId(): string {
  return `worker-${randomUUID()}`;
}

export interface PingWorkerOptions {
  connection: NativeConnection;
  namespace: string;
  taskQueue: string;
  workerId: string;
  activityDelayMs: number;
  nodeEnv: string;
  logLevel?: string;
  shutdownGraceTime?: Duration;
}

/** Builds the worker; shared by main.ts and the integration tests. */
export function createPingWorker(options: PingWorkerOptions): Promise<Worker> {
  const logger = createLogger({ component: 'worker', level: options.logLevel ?? 'warn' });
  return Worker.create({
    connection: options.connection,
    namespace: options.namespace,
    taskQueue: options.taskQueue,
    workflowsPath: path.resolve(__dirname, 'workflows'),
    activities: createPingActivities({
      workerId: options.workerId,
      delayMs: options.activityDelayMs,
      nodeEnv: options.nodeEnv,
      logger,
    }),
    ...(options.shutdownGraceTime === undefined
      ? {}
      : { shutdownGraceTime: options.shutdownGraceTime }),
  });
}
