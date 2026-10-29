import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { NativeConnection, Runtime, type Worker } from '@temporalio/worker';
import { InvalidConfigError, parseEnv, type WorkerConfig } from './config/env.schema';
import { loadLocalEnv } from './config/load-env';
import { startHealthServer } from './health/server';
import { createWorkerLogger, PinoTemporalLogger } from './logging/logger';
import { createPingWorker } from './worker';

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

  try {
    worker = await createPingWorker({
      connection,
      namespace: config.TEMPORAL_NAMESPACE,
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      workerId: `${hostname()}-${process.pid}`,
      activityDelayMs: config.PING_ACTIVITY_DELAY_MS,
      nodeEnv: config.NODE_ENV,
      logLevel: config.LOG_LEVEL,
    });
    logger.info({ taskQueue: config.TEMPORAL_TASK_QUEUE }, 'Worker started');
    await worker.run();
  } finally {
    await connection.close();
    health.close();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
