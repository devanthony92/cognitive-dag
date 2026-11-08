import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { WorkflowHandle } from '@temporalio/client';
import type { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import {
  EXECUTE_DAG_WORKFLOW_NAME,
  type ExecuteDagInput,
  type ExecuteDagResult,
  type RunEvent,
} from '@cognitive-dag/contracts';

export const workflowsPath = path.resolve(__dirname, '../../src/workflows');

export type ExecuteDagWorkflow = (input: unknown) => Promise<ExecuteDagResult>;

export interface EngineRun {
  handle: WorkflowHandle<ExecuteDagWorkflow>;
  input: ExecuteDagInput;
  /** Every event the interpreter asked to record, in order. */
  events: RunEvent[];
  /** Inputs of `notifyApprovers`, as the activity received them. */
  notified: Array<Record<string, unknown>>;
  /** Inputs of `httpRequest`. */
  httpCalls: Array<Record<string, unknown>>;
  result(): Promise<ExecuteDagResult | Error>;
}

export interface EngineOptions {
  dag: unknown;
  input?: Partial<ExecuteDagInput>;
  /** Replaces or adds activities of the default set. */
  activities?: Record<string, (...args: never[]) => Promise<unknown>>;
  /** Concurrent activity executions of the one worker (to show a wait holds none). */
  maxConcurrentActivities?: number;
  /** Runs while the worker is up, after the workflow has started. */
  during?: (run: EngineRun) => Promise<void>;
}

/**
 * Runs `executeDag` against the local Temporal server with stubbed activities. The default
 * activities record the events, answer `mockService` with ok and swallow the notification.
 */
export async function runEngine(
  env: TestWorkflowEnvironment,
  options: EngineOptions,
): Promise<EngineRun & { done: Awaited<ReturnType<EngineRun['result']>> }> {
  const taskQueue = `test-${randomUUID()}`;
  const events: RunEvent[] = [];
  const notified: Array<Record<string, unknown>> = [];
  const httpCalls: Array<Record<string, unknown>> = [];
  const input: ExecuteDagInput = {
    organizationId: randomUUID(),
    workflowId: randomUUID(),
    versionId: randomUUID(),
    versionNumber: 1,
    runId: randomUUID(),
    correlationId: randomUUID(),
    definition: options.dag as Record<string, unknown>,
    triggerInput: {},
    executablePhases: ['F3', 'F7'],
    httpTaskQueue: taskQueue,
    ...options.input,
  };

  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowsPath,
    ...(options.maxConcurrentActivities
      ? { maxConcurrentActivityTaskExecutions: options.maxConcurrentActivities }
      : {}),
    activities: {
      recordRunEvent: (event: RunEvent) => {
        events.push(event);
        return Promise.resolve();
      },
      mockService: () => Promise.resolve({ output: { ok: true }, attempts: 1 }),
      notifyApprovers: (value: Record<string, unknown>) => {
        notified.push(value);
        return Promise.resolve({ notified: 0 });
      },
      httpRequest: (value: Record<string, unknown>) => {
        httpCalls.push(value);
        return Promise.resolve({ output: { status: 200, body: 'ok' }, attempts: 1 });
      },
      ...options.activities,
    },
  });

  return worker.runUntil(async () => {
    const handle = await env.client.workflow.start<ExecuteDagWorkflow>(EXECUTE_DAG_WORKFLOW_NAME, {
      taskQueue,
      workflowId: `run-${input.runId}`,
      args: [input],
    });
    const run: EngineRun = {
      handle,
      input,
      events,
      notified,
      httpCalls,
      result: () =>
        handle
          .result()
          .catch((error: unknown) => (error instanceof Error ? error : new Error(String(error)))),
    };
    await options.during?.(run);
    const done = await run.result();
    return { ...run, done };
  });
}

/** Polls until `check` is true or the time runs out; a workflow progresses on its own clock. */
export async function waitFor(check: () => boolean, timeoutMs = 20_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out waiting for a condition');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export const eventsOf = (run: Pick<EngineRun, 'events'>, transition: string) =>
  run.events.filter((event) => event.transition === transition);
