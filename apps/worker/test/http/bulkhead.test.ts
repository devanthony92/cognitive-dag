import { randomUUID } from 'node:crypto';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EXECUTE_DAG_WORKFLOW_NAME,
  type ExecuteDagInput,
  type RunEvent,
} from '@cognitive-dag/contracts';
import { classifyNode, definition, edge, mock, node, trigger } from '../helpers/dags';
import { waitFor, workflowsPath } from '../support/engine';

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createLocal();
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

describe('bulkhead of the HTTP queue', () => {
  it('a saturated http queue does not slow the LLM nor the mock.service activities', async () => {
    const main = `main-${randomUUID()}`;
    const llm = `llm-${randomUUID()}`;
    const http = `http-${randomUUID()}`;
    const events: RunEvent[] = [];
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let released = false;

    const mainWorker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: main,
      workflowsPath,
      activities: {
        recordRunEvent: (event: RunEvent) => {
          events.push(event);
          return Promise.resolve();
        },
        mockService: () => Promise.resolve({ output: { ok: true }, attempts: 1 }),
        notifyApprovers: () => Promise.resolve({ notified: 0 }),
      },
    });
    const llmWorker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: llm,
      activities: {
        llmClassify: () => Promise.resolve({ output: { label: 'positivo' }, attempts: 1 }),
      },
    });
    // One slot only: the first call occupies it and the rest queue behind it.
    const httpWorker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: http,
      maxConcurrentActivityTaskExecutions: 1,
      activities: {
        httpRequest: async () => {
          started += 1;
          await gate;
          return { output: { status: 200, body: 'ok' }, attempts: 1 };
        },
      },
    });

    const httpDag = definition(
      [
        trigger(),
        node('call', 'http.request', {
          method: 'GET',
          url: 'https://example.com',
          headers: {},
          body: '',
        }),
      ],
      [edge('trigger', 'call')],
    );
    const otherDag = definition(
      [trigger(), mock('a'), classifyNode('c')],
      [edge('trigger', 'a'), edge('a', 'c')],
    );
    const startRun = (dag: unknown) => {
      const input: ExecuteDagInput = {
        organizationId: randomUUID(),
        workflowId: randomUUID(),
        versionId: randomUUID(),
        versionNumber: 1,
        runId: randomUUID(),
        correlationId: randomUUID(),
        definition: dag as Record<string, unknown>,
        triggerInput: { amount: 1, tone: 'x' },
        executablePhases: ['F3', 'F5', 'F7'],
        llmTaskQueue: llm,
        httpTaskQueue: http,
      };
      return env.client.workflow.start(EXECUTE_DAG_WORKFLOW_NAME, {
        taskQueue: main,
        workflowId: `run-${input.runId}`,
        args: [input],
      });
    };

    await Promise.all([
      mainWorker.runUntil(async () => {
        await llmWorker.runUntil(async () => {
          await httpWorker.runUntil(async () => {
            const blocked = await Promise.all([
              startRun(httpDag),
              startRun(httpDag),
              startRun(httpDag),
            ]);
            await waitFor(() => started >= 1);
            const startedAt = Date.now();
            const free = await startRun(otherDag);
            await free.result();
            const elapsed = Date.now() - startedAt;
            // The http queue is still jammed while the others finished.
            expect(released).toBe(false);
            expect(started).toBe(1);
            expect(elapsed).toBeLessThan(5000);
            released = true;
            release();
            await Promise.all(blocked.map((handle) => handle.result()));
          });
        });
      }),
    ]);
    expect(
      events.filter((event) => event.transition === 'run.finished' && event.status === 'succeeded'),
    ).toHaveLength(4);
  }, 90_000);
});
