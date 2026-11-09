import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Duration } from '@temporalio/common';
import type Valkey from 'iovalkey';
import { Worker, type NativeConnection } from '@temporalio/worker';
import { createLogger, type Logger } from '@cognitive-dag/logger';
import type { WithContext } from '@cognitive-dag/db';
import { createMockServiceActivities } from './activities/mock-service';
import { createPingActivities } from './activities/ping.activities';
import { createRunEventActivities, type RunEventActivities } from './activities/record-run-event';
import { createEffectStore, createMockDestination } from './resilience/effects';
import type { RateLimits } from './resilience/rate-limit-config';
import { createModelRateLimiter, createRateLimiter } from './resilience/rate-limiter';
import type { BucketConfig } from './resilience/rate-limit-config';
import type { LlmProvider, Prices } from '@cognitive-dag/llm';
import { createLlmActivities, type LlmNodeType } from './llm/activities';
import { createBudget, type BudgetLimits } from './llm/budget';
import { createCompilerActivities } from './compiler/activities';
import { createCompilerBudget } from './compiler/budget';
import { createCompilationStore } from './compiler/store';
import { createApprovalActivities } from './approvals/activities';
import type { Mailer } from './approvals/mail';
import { createHttpActivities, type HttpWaitingMark, type ResolveFn } from './http/activities';
import { createValkeyCircuitBreaker } from './http/circuit-breaker';
import { createCredentialResolver } from './http/credentials';
import { createScheduleActivities } from './schedules/activities';

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

/** What the main worker needs for the triggers and the human control of F7. */
export interface TriggersWorkerOptions {
  /** `TRIGGERS_ENABLED`: the launcher skips every firing when false. */
  triggersOn: boolean;
  /** `LLM_ENABLED`: scheduled runs may include F5 nodes only if the LLM is on. */
  llmEnabled: boolean;
  llmTaskQueue: string;
  httpTaskQueue: string;
  mailer: Mailer;
  /** `APPROVAL_EMAIL_MAX_RECIPIENTS` */
  approvalMaxRecipients: number;
  /** `APP_BASE_URL` */
  appBaseUrl?: string;
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
  /** The launcher of schedules and the approval emails (F7); needs `runs` for the database. */
  triggers?: TriggersWorkerOptions;
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
      ...(options.runs && options.triggers
        ? {
            ...createScheduleActivities({
              withContext: options.runs.withContext,
              logger,
              triggersOn: options.triggers.triggersOn,
              llmEnabled: options.triggers.llmEnabled,
              llmTaskQueue: options.triggers.llmTaskQueue,
              httpTaskQueue: options.triggers.httpTaskQueue,
            }),
            ...createApprovalActivities({
              withContext: options.runs.withContext,
              logger,
              mailer: options.triggers.mailer,
              maxRecipients: options.triggers.approvalMaxRecipients,
              appBaseUrl: options.triggers.appBaseUrl,
            }),
          }
        : {}),
    },
    ...(options.shutdownGraceTime === undefined
      ? {}
      : { shutdownGraceTime: options.shutdownGraceTime }),
  });
}

export interface LlmWorkerOptions {
  connection: NativeConnection;
  namespace: string;
  /** `TEMPORAL_LLM_TASK_QUEUE`: the bulkhead of the LLM activities (research R6). */
  taskQueue: string;
  logLevel?: string;
  logger?: Logger;
  shutdownGraceTime?: Duration;
  provider: LlmProvider;
  withContext: WithContext;
  valkey?: Valkey;
  /** Bucket by organization and node type (F4). */
  rateLimits?: RateLimits;
  /** Global bucket by model (`rl:global:<model>`). */
  modelRateLimit?: BucketConfig;
  limits: BudgetLimits;
  /** `LLM_ENABLED` */
  enabled: boolean;
  models: Readonly<Record<LlmNodeType, string>>;
  prices: Prices;
  maxInputChars: number;
  /** `LLM_MAX_CONCURRENT_ACTIVITIES`: LLM calls never take the slots of the other nodes. */
  maxConcurrentActivities: number;
  /** The NL -> DAG compiler (F6); without it the worker does not serve `compileIntent`. */
  compiler?: {
    /** `LLM_MODEL_COMPILER` */
    model: string;
    /** `LLM_MAX_TOKENS_PER_COMPILATION` */
    maxTokensPerCompilation: number;
  };
}

/**
 * Second worker of the process (research R6): it only serves the LLM activities, on their own task
 * queue and with their own concurrency, so a slow or limited provider cannot starve the rest.
 */
export function createLlmWorker(options: LlmWorkerOptions): Promise<Worker> {
  const logger =
    options.logger ?? createLogger({ component: 'worker-llm', level: options.logLevel ?? 'warn' });
  const activities = createLlmActivities({
    logger,
    provider: options.provider,
    budget: createBudget({ withContext: options.withContext, limits: options.limits, logger }),
    enabled: options.enabled,
    models: options.models,
    prices: options.prices,
    maxInputChars: options.maxInputChars,
    ...(options.valkey
      ? {
          rateLimiter: createRateLimiter({
            valkey: options.valkey,
            limits: options.rateLimits ?? {},
          }),
          ...(options.modelRateLimit
            ? {
                modelRateLimiter: createModelRateLimiter({
                  valkey: options.valkey,
                  limit: options.modelRateLimit,
                }),
              }
            : {}),
        }
      : {}),
  });
  const modelRateLimiter =
    options.valkey && options.modelRateLimit
      ? createModelRateLimiter({ valkey: options.valkey, limit: options.modelRateLimit })
      : undefined;
  const compiler = options.compiler
    ? createCompilerActivities({
        logger,
        provider: options.provider,
        budget: createCompilerBudget({
          withContext: options.withContext,
          limits: {
            perCompilation: options.compiler.maxTokensPerCompilation,
            perOrganizationDay: options.limits.perOrganizationDay,
          },
          logger,
        }),
        store: createCompilationStore(options.withContext),
        enabled: options.enabled,
        model: options.compiler.model,
        prices: options.prices,
        ...(modelRateLimiter ? { modelRateLimiter } : {}),
      })
    : {};
  return Worker.create({
    connection: options.connection,
    namespace: options.namespace,
    taskQueue: options.taskQueue,
    activities: { ...activities, ...compiler },
    maxConcurrentActivityTaskExecutions: options.maxConcurrentActivities,
    ...(options.shutdownGraceTime === undefined
      ? {}
      : { shutdownGraceTime: options.shutdownGraceTime }),
  });
}

export interface HttpWorkerOptions {
  connection: NativeConnection;
  namespace: string;
  /** `TEMPORAL_HTTP_TASK_QUEUE`: the bulkhead of the HTTP activities (F7, research R12). */
  taskQueue: string;
  logLevel?: string;
  logger?: Logger;
  shutdownGraceTime?: Duration;
  withContext: WithContext;
  valkey: Valkey;
  /** Marks a step as waiting (rate limit, open circuit); the same recorder as the main worker. */
  recorder?: RunEventActivities;
  /** Token bucket by node type (`RATE_LIMIT_HTTP_REQUEST`). */
  rateLimits?: RateLimits;
  /** `HTTP_ENABLED` */
  enabled: boolean;
  /** `CREDENTIALS_MASTER_KEY` decoded. */
  masterKey: Buffer | undefined;
  breaker: {
    failures: number;
    windowSeconds: number;
    cooldownSeconds: number;
    maxWaitSeconds: number;
  };
  /** `HTTP_MAX_CONCURRENT_ACTIVITIES`: HTTP calls never take the slots of the other nodes. */
  maxConcurrentActivities: number;
  /** `HTTP_TEST_ALLOW_LOOPBACK` and the certificate of the local server; tests only. */
  allowLoopback?: boolean;
  tls?: { ca?: string | Buffer };
  resolve?: ResolveFn;
}

/**
 * Third worker of the process (F7, research R12): it only serves the HTTP activities, on their own
 * task queue and with their own concurrency, so a slow or failing destination cannot starve the LLM
 * nodes, the simulated service or the recording of runs.
 */
export function createHttpWorker(options: HttpWorkerOptions): Promise<Worker> {
  const logger =
    options.logger ?? createLogger({ component: 'worker-http', level: options.logLevel ?? 'warn' });
  const { recorder } = options;
  const activities = createHttpActivities({
    logger,
    enabled: options.enabled,
    credentials: createCredentialResolver({
      withContext: options.withContext,
      masterKey: options.masterKey,
    }),
    breaker: createValkeyCircuitBreaker(options.valkey, {
      failureThreshold: options.breaker.failures,
      windowMs: options.breaker.windowSeconds * 1000,
      cooldownMs: options.breaker.cooldownSeconds * 1000,
    }),
    breakerMaxWaitMs: options.breaker.maxWaitSeconds * 1000,
    rateLimiter: createRateLimiter({ valkey: options.valkey, limits: options.rateLimits ?? {} }),
    effects: createEffectStore(options.withContext),
    ...(recorder
      ? {
          markWaiting: (mark: HttpWaitingMark) =>
            recorder.recordRunEvent({
              organizationId: mark.organizationId,
              runId: mark.runId,
              correlationId: mark.correlationId,
              at: new Date().toISOString(),
              transition: 'step.running',
              nodeId: mark.nodeId,
              nodeType: 'http.request',
              ...(mark.waitingReason ? { waitingReason: mark.waitingReason } : {}),
            }),
        }
      : {}),
    ...(options.allowLoopback ? { allowLoopback: true } : {}),
    ...(options.tls ? { tls: options.tls } : {}),
    ...(options.resolve ? { resolve: options.resolve } : {}),
  });
  return Worker.create({
    connection: options.connection,
    namespace: options.namespace,
    taskQueue: options.taskQueue,
    activities,
    maxConcurrentActivityTaskExecutions: options.maxConcurrentActivities,
    ...(options.shutdownGraceTime === undefined
      ? {}
      : { shutdownGraceTime: options.shutdownGraceTime }),
  });
}
