// Runs a ping worker as a standalone process so a test can kill it with SIGKILL.
import { NativeConnection } from '@temporalio/worker';
import { createPingWorker } from '../../../src/worker';

async function main(): Promise<void> {
  const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS });
  const worker = await createPingWorker({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    taskQueue: process.env.TASK_QUEUE ?? '',
    workerId: process.env.WORKER_ID ?? 'crash-worker',
    activityDelayMs: Number(process.env.ACTIVITY_DELAY_MS ?? 0),
    nodeEnv: 'test',
  });
  await worker.run();
}

void main();
