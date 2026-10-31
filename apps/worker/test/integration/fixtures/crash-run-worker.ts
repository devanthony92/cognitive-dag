// Runs a worker with the execution engine as a standalone process so a test can SIGKILL it.
import Valkey from 'iovalkey';
import { NativeConnection } from '@temporalio/worker';
import { createDatabase } from '@cognitive-dag/db';
import { createWorker } from '../../../src/worker';

async function main(): Promise<void> {
  const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS });
  const database = createDatabase({ connectionString: process.env.DATABASE_URL ?? '', max: 2 });
  const valkey = new Valkey(process.env.VALKEY_URL ?? '');
  valkey.on('error', () => undefined);
  const worker = await createWorker({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    taskQueue: process.env.TASK_QUEUE ?? '',
    workerId: process.env.WORKER_ID ?? 'crash-run-worker',
    activityDelayMs: 0,
    nodeEnv: 'test',
    runs: {
      withContext: database.withContext,
      publish: (channel, message) => valkey.publish(channel, message),
    },
  });
  await worker.run();
}

void main();
