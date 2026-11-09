import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { NativeConnection, Runtime, type Worker } from '@temporalio/worker';
import { Client, Connection } from '@temporalio/client';
import Valkey from 'iovalkey';
import { createDatabase } from '@cognitive-dag/db';
import { InvalidConfigError, parseEnv, type WorkerConfig } from './config/env.schema';
import { loadLocalEnv } from './config/load-env';
import { startHealthServer } from './health/server';
import { createWorkerLogger, PinoTemporalLogger } from './logging/logger';
import { createProvider } from './llm/provider';
import { createRunEventActivities } from './activities/record-run-event';
import { createSmtpMailer } from './approvals/mail';
import { createScheduleReconciler } from './schedules/reconciler';
import { createHttpWorker, createLlmWorker, createWorker, createWorkerId } from './worker';

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
  logger.info(
    { provider: config.LLM_PROVIDER, enabled: config.LLM_ENABLED, models: config.llmModels },
    'LLM configuration',
  );
  if (config.llmModelsWithoutPrice.length > 0) {
    logger.warn(
      { models: config.llmModelsWithoutPrice },
      'LLM models without a price in LLM_PRICES: their cost is recorded as 0',
    );
  }

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

  const mailer = createSmtpMailer({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    from: config.MAIL_FROM,
  });
  // The reconciler uses the Schedule API of the client; the worker connection is a native one.
  const clientConnection = await Connection.connect({ address: config.TEMPORAL_ADDRESS });
  const reconcilerStop = new AbortController();

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
        valkey,
        rateLimits: config.rateLimits,
      },
      triggers: {
        triggersOn: config.TRIGGERS_ENABLED,
        llmEnabled: config.LLM_ENABLED,
        llmTaskQueue: config.TEMPORAL_LLM_TASK_QUEUE,
        httpTaskQueue: config.TEMPORAL_HTTP_TASK_QUEUE,
        mailer,
        approvalMaxRecipients: config.APPROVAL_EMAIL_MAX_RECIPIENTS,
        ...(config.APP_BASE_URL ? { appBaseUrl: config.APP_BASE_URL } : {}),
      },
    });
    const llmWorker = await createLlmWorker({
      connection,
      namespace: config.TEMPORAL_NAMESPACE,
      taskQueue: config.TEMPORAL_LLM_TASK_QUEUE,
      logLevel: config.LOG_LEVEL,
      provider: createProvider(config),
      withContext: database.withContext,
      valkey,
      rateLimits: config.rateLimits,
      modelRateLimit: config.llmModelRateLimit,
      limits: {
        perRun: config.LLM_MAX_TOKENS_PER_RUN,
        perOrganizationDay: config.LLM_MAX_TOKENS_PER_ORG_DAY,
      },
      enabled: config.LLM_ENABLED,
      models: config.llmModels,
      prices: config.llmPrices,
      maxInputChars: config.LLM_MAX_INPUT_CHARS,
      maxConcurrentActivities: config.LLM_MAX_CONCURRENT_ACTIVITIES,
      compiler: {
        model: config.LLM_MODEL_COMPILER,
        maxTokensPerCompilation: config.LLM_MAX_TOKENS_PER_COMPILATION,
      },
    });
    const httpWorker = await createHttpWorker({
      connection,
      namespace: config.TEMPORAL_NAMESPACE,
      taskQueue: config.TEMPORAL_HTTP_TASK_QUEUE,
      logLevel: config.LOG_LEVEL,
      withContext: database.withContext,
      valkey,
      recorder: createRunEventActivities({
        withContext: database.withContext,
        publish: (channel, message) => valkey.publish(channel, message),
        logger,
      }),
      rateLimits: config.rateLimits,
      enabled: config.HTTP_ENABLED,
      masterKey: config.credentialsMasterKey,
      breaker: {
        failures: config.HTTP_CB_FAILURES,
        windowSeconds: config.HTTP_CB_WINDOW_SECONDS,
        cooldownSeconds: config.HTTP_CB_COOLDOWN_SECONDS,
        maxWaitSeconds: config.HTTP_CB_MAX_WAIT_SECONDS,
      },
      maxConcurrentActivities: config.HTTP_MAX_CONCURRENT_ACTIVITIES,
      allowLoopback: config.HTTP_TEST_ALLOW_LOOPBACK,
    });
    const reconciler = createScheduleReconciler({
      withContext: database.withContext,
      client: new Client({ connection: clientConnection, namespace: config.TEMPORAL_NAMESPACE }),
      taskQueue: config.TEMPORAL_TASK_QUEUE,
      catchupWindowSeconds: config.SCHEDULE_CATCHUP_WINDOW_SECONDS,
      triggersOn: config.TRIGGERS_ENABLED,
      logger,
    });
    logger.info(
      {
        taskQueue: config.TEMPORAL_TASK_QUEUE,
        llmTaskQueue: config.TEMPORAL_LLM_TASK_QUEUE,
        httpTaskQueue: config.TEMPORAL_HTTP_TASK_QUEUE,
        triggersOn: config.TRIGGERS_ENABLED,
        httpEnabled: config.HTTP_ENABLED,
      },
      'Worker started',
    );
    await Promise.all([
      worker.run(),
      llmWorker.run(),
      httpWorker.run(),
      reconciler.run(reconcilerStop.signal),
    ]);
  } finally {
    reconcilerStop.abort();
    mailer.close();
    await clientConnection.close();
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
