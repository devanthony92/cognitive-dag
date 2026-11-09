// Runs a worker with the execution engine as a standalone process so a test can SIGKILL it. With
// HTTP_TASK_QUEUE it also serves the F7 activities (approvals, schedules, HTTP) like the real worker.
import Valkey from 'iovalkey';
import { NativeConnection } from '@temporalio/worker';
import { createDatabase } from '@cognitive-dag/db';
import { createHttpWorker, createWorker } from '../../../src/worker';

async function main(): Promise<void> {
  const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS });
  const database = createDatabase({ connectionString: process.env.DATABASE_URL ?? '', max: 2 });
  const valkey = new Valkey(process.env.VALKEY_URL ?? '');
  valkey.on('error', () => undefined);
  const namespace = process.env.TEMPORAL_NAMESPACE ?? 'default';
  const httpQueue = process.env.HTTP_TASK_QUEUE;
  const worker = await createWorker({
    connection,
    namespace,
    taskQueue: process.env.TASK_QUEUE ?? '',
    workerId: process.env.WORKER_ID ?? 'crash-run-worker',
    activityDelayMs: 0,
    nodeEnv: 'test',
    runs: {
      withContext: database.withContext,
      publish: (channel, message) => valkey.publish(channel, message),
      valkey,
    },
    ...(httpQueue
      ? {
          triggers: {
            triggersOn: true,
            llmEnabled: false,
            llmTaskQueue: 'unused',
            httpTaskQueue: httpQueue,
            mailer: { send: () => Promise.resolve(), close: () => undefined },
            approvalMaxRecipients: 20,
          },
        }
      : {}),
  });
  const running = [worker.run()];
  if (httpQueue) {
    const http = await createHttpWorker({
      connection,
      namespace,
      taskQueue: httpQueue,
      withContext: database.withContext,
      valkey,
      enabled: true,
      masterKey: undefined,
      breaker: { failures: 5, windowSeconds: 60, cooldownSeconds: 2, maxWaitSeconds: 120 },
      maxConcurrentActivities: 5,
      allowLoopback: true,
      ...(process.env.HTTP_TEST_CA ? { tls: { ca: process.env.HTTP_TEST_CA } } : {}),
    });
    running.push(http.run());
  }
  await Promise.all(running);
}

void main();
