import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { NativeConnection, type Worker } from '@temporalio/worker';
import { createPingWorker } from '../../../worker/src/worker';
import { startTestApp, testConfig } from './helpers';

/** Task queue unique per test, so tests sharing the Compose Temporal never see each other's work. */
export function uniqueTaskQueue(): string {
  return `test-${randomUUID()}`;
}

export async function startPingApi(
  taskQueue: string,
  flags = '{"ping-enabled":true}',
): Promise<INestApplication> {
  return startTestApp({ TEMPORAL_TASK_QUEUE: taskQueue, FEATURE_FLAGS: flags });
}

export interface RunningWorker {
  worker: Worker;
  stop(): Promise<void>;
}

/** Runs a real ping worker in-process on the given task queue. */
export async function startPingWorker(
  taskQueue: string,
  options: { workerId?: string; delayMs?: number } = {},
): Promise<RunningWorker> {
  const config = testConfig();
  const connection = await NativeConnection.connect({ address: config.TEMPORAL_ADDRESS });
  const worker = await createPingWorker({
    connection,
    namespace: config.TEMPORAL_NAMESPACE,
    taskQueue,
    workerId: options.workerId ?? `test-${randomUUID()}`,
    activityDelayMs: options.delayMs ?? 0,
    nodeEnv: 'test',
    shutdownGraceTime: '1s',
  });
  const done = worker.run().finally(() => connection.close());
  return {
    worker,
    async stop() {
      worker.shutdown();
      await done;
    },
  };
}

export async function waitFor<T>(
  probe: () => Promise<T | undefined>,
  timeoutMs = 20_000,
  intervalMs = 200,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
