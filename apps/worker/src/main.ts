import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { NativeConnection, Runtime, type Worker } from '@temporalio/worker';
import Valkey from 'iovalkey';
import { createDatabase } from '@cognitive-dag/db';
import { InvalidConfigError, parseEnv, type WorkerConfig } from './config/env.schema';
import { loadLocalEnv } from './config/load-env';
import { startHealthServer } from './health/server';
import { createWorkerLogger, PinoTemporalLogger } from './logging/logger';
import { createWorker, createWorkerId } from './worker';

const MAX_CONNECT_BACKOFF_MS = 10_000;

function loadConfig(): WorkerConfig {
  loadLocalEnv();
  try {
    return parseEnv(process.env);
  } catch (error) {
    if (error instanceof InvalidConfigError) {
      // Fail closed: refuse to start and name the variables, never their values.
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

async function run(): Promise<void> {
  const config = loadConfig();
  const logger = createWorkerLogger(config.LOG_LEVEL);
  Runtime.install({ logger: new PinoTemporalLogger(logger) });

  const workerId = createWorkerId();
  logger.info({ workerId, hostname: hostname(), pid: process.pid }, 'Worker identity');

  let worker: Worker | undefined;
  const health = await startHealthServer(
    config.WORKER_HEALTH_PORT,
    () => worker?.getState() === 'RUNNING',
  );

  // Keep retrying while Temporal is unavailable instead of crashing.
  let connection: NativeConnection | undefined;
  for (let attempt = 1, backoff = 500; !connection; attempt++) {
    try {
      connection = await NativeConnection.connect({ address: config.TEMPORAL_ADDRESS });
    } catch (error) {
      logger.warn({ err: error, attempt }, 'Temporal unavailable, retrying');
      await sleep(backoff);
      backoff = Math.min(backoff * 2, MAX_CONNECT_BACKOFF_MS);
    }
  }

  // Run records are written as app_runtime, never as the migrator; live events go to Valkey.
  const database = createDatabase({ connectionString: config.DATABASE_URL, max: 5 });
  const valkey = new Valkey(config.VALKEY_URL, {
    connectTimeout: 2_000,
    commandTimeout: 2_000,
    maxRetriesPerRequest: 1,
  });
  valkey.on('error', () => undefined);

  try {
    worker = await createWorker({
      connection,
      namespace: config.TEMPORAL_NAMESPACE,
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workerId,
      activityDelayMs: config.PING_ACTIVITY_DELAY_MS,
      nodeEnv: config.NODE_ENV,
      logLevel: config.LOG_LEVEL,
      runs: {
        withContext: database.withContext,
        publish: (channel, message) => valkey.publish(channel, message),
      },
    });
    logger.info({ taskQueue: config.TEMPORAL_TASK_QUEUE }, 'Worker started');
    await worker.run();
  } finally {
    valkey.disconnect();
    await database.end();
    await connection.close();
    health.close();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
