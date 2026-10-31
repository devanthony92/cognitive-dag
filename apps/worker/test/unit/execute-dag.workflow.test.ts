import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ApplicationFailure, Context } from '@temporalio/activity';
import { WorkflowFailedError, type WorkflowHandle } from '@temporalio/client';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EXECUTE_DAG_WORKFLOW_NAME,
  type ExecuteDagInput,
  type ExecuteDagResult,
  type RunEvent,
} from '@cognitive-dag/contracts';
import { condition, definition, edge, merge, mock, node, trigger } from '../helpers/dags';
import type { MockServiceInput, MockServiceResult } from '../../src/activities/mock-service';

const workflowsPath = path.resolve(__dirname, '../../src/workflows');

// ---- Harness -------------------------------------------------------------------------------

type ExecuteDagWorkflow = (input: unknown) => Promise<ExecuteDagResult>;

type MockBehavior = (input: MockServiceInput, attempt: number) => Promise<MockServiceResult>;

interface Harness {
  events: RunEvent[];
  calls: string[];
  maxConcurrent: () => number;
  /** Time from the start of the workflow to its result (the worker shutdown is not included). */
  elapsedMs: number;
}

describe('executeDag', () => {
  let env: TestWorkflowEnvironment;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createLocal();
  }, 120_000);

  afterAll(async () => {
    await env?.teardown();
  });

  async function execute(
    dag: ReturnType<typeof definition>,
    options: {
      triggerInput?: Record<string, unknown>;
      behavior?: MockBehavior;
      maxDurationMs?: number;
      during?: (handle: WorkflowHandle<ExecuteDagWorkflow>, harness: Harness) => Promise<void>;
    } = {},
  ): Promise<{ result: ExecuteDagResult | Error; harness: Harness; input: ExecuteDagInput }> {
    const taskQueue = `test-${randomUUID()}`;
    const events: RunEvent[] = [];
    const calls: string[] = [];
    let active = 0;
    let peak = 0;
    const harness: Harness = { events, calls, maxConcurrent: () => peak, elapsedMs: 0 };

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowsPath,
      activities: {
        recordRunEvent: (event: RunEvent) => {
          events.push(event);
          return Promise.resolve();
        },
        mockService: async (input: MockServiceInput): Promise<MockServiceResult> => {
          calls.push(input.nodeId);
          active += 1;
          peak = Math.max(peak, active);
          try {
            const attempt = Context.current().info.attempt;
            return options.behavior
              ? await options.behavior(input, attempt)
              : { output: { ok: true }, attempts: attempt };
          } finally {
            active -= 1;
          }
        },
      },
    });

    const input: ExecuteDagInput = {
      organizationId: randomUUID(),
      workflowId: randomUUID(),
      versionId: randomUUID(),
      versionNumber: 1,
      runId: randomUUID(),
      correlationId: randomUUID(),
      definition: dag,
      triggerInput: options.triggerInput ?? { amount: 150, tone: 'happy' },
      ...(options.maxDurationMs === undefined ? {} : { maxDurationMs: options.maxDurationMs }),
    };

    return worker.runUntil(async () => {
      const handle = await env.client.workflow.start<ExecuteDagWorkflow>(
        EXECUTE_DAG_WORKFLOW_NAME,
        {
          taskQueue,
          workflowId: `run-${input.runId}`,
          args: [input],
        },
      );
      const startedAt = Date.now();
      await options.during?.(handle, harness);
      const result = await handle
        .result()
        .catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
      harness.elapsedMs = Date.now() - startedAt;
      return { result, harness, input };
    });
  }

  const stepEvents = (h: Harness, transition: string) =>
    h.events
      .filter((e) => e.transition === transition)
      .map((e) => (e as { nodeId: string }).nodeId);
  const finished = (h: Harness) => {
    const event = h.events.find((e) => e.transition === 'run.finished');
    return event?.transition === 'run.finished' ? event : undefined;
  };
  const indexOf = (h: Harness, transition: string, nodeId: string) =>
    h.events.findIndex(
      (e) => e.transition === transition && (e as { nodeId?: string }).nodeId === nodeId,
    );

  it('runs a linear DAG, records every transition and returns the outputs', async () => {
    const dag = definition(
      [trigger(), mock('a'), mock('b')],
      [edge('trigger', 'a'), edge('a', 'b')],
    );
    const { result, harness, input } = await execute(dag);
    expect((result as ExecuteDagResult).status).toBe('succeeded');
    expect((result as ExecuteDagResult).outputs).toMatchObject({
      trigger: { amount: 150, tone: 'happy' },
      a: { ok: true },
      b: { ok: true },
    });

    const started = harness.events[0];
    expect(started).toMatchObject({
      transition: 'run.started',
      runId: input.runId,
      organizationId: input.organizationId,
      correlationId: input.correlationId,
    });
    expect((started as { nodes: unknown[] }).nodes).toHaveLength(3);
    expect(stepEvents(harness, 'step.succeeded')).toEqual(['trigger', 'a', 'b']);
    expect(finished(harness)).toMatchObject({ status: 'succeeded' });
    expect(harness.events.at(-1)?.transition).toBe('run.finished');
  });

  it('runs independent branches in parallel', async () => {
    const slow: MockBehavior = async (_input, attempt) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return { output: { ok: true }, attempts: attempt };
    };
    const dag = definition(
      [trigger(), mock('x'), mock('y'), mock('z'), merge('end', 'all')],
      [
        edge('trigger', 'x'),
        edge('trigger', 'y'),
        edge('trigger', 'z'),
        edge('x', 'end'),
        edge('y', 'end'),
        edge('z', 'end'),
      ],
    );
    const { result, harness } = await execute(dag, { behavior: slow });
    expect((result as ExecuteDagResult).status).toBe('succeeded');
    expect(harness.maxConcurrent()).toBe(3);
    expect(stepEvents(harness, 'step.succeeded').at(-1)).toBe('end');
  });

  describe('conditions and skipped branches', () => {
    const dag = (threshold: number) =>
      definition(
        [
          trigger(),
          condition('check', threshold),
          mock('big'),
          mock('small'),
          merge('join', 'all'),
          mock('after'),
        ],
        [
          edge('trigger', 'check'),
          edge('check', 'big', 'true'),
          edge('check', 'small', 'false'),
          edge('big', 'join'),
          edge('small', 'join'),
          edge('join', 'after'),
        ],
      );

    it('takes the true branch using the resolved reference, skips the other, merge all waits only for the executed one', async () => {
      const { result, harness } = await execute(dag(100));
      expect((result as ExecuteDagResult).status).toBe('succeeded');
      expect(harness.calls).toEqual(['big', 'after']);
      expect(stepEvents(harness, 'step.skipped')).toEqual(['small']);
      expect(stepEvents(harness, 'step.succeeded')).toEqual([
        'trigger',
        'check',
        'big',
        'join',
        'after',
      ]);
    });

    it('takes the false branch when the condition is false', async () => {
      const { harness } = await execute(dag(500));
      expect(harness.calls).toEqual(['small', 'after']);
      expect(stepEvents(harness, 'step.skipped')).toEqual(['big']);
    });

    it('skips everything downstream of a branch that is not taken', async () => {
      const chain = definition(
        [trigger(), condition('check', 500), mock('a'), mock('b'), mock('c')],
        [edge('trigger', 'check'), edge('check', 'a', 'true'), edge('a', 'b'), edge('b', 'c')],
      );
      const { result, harness } = await execute(chain);
      expect((result as ExecuteDagResult).status).toBe('succeeded');
      expect(harness.calls).toEqual([]);
      expect(stepEvents(harness, 'step.skipped').sort()).toEqual(['a', 'b', 'c']);
    });
  });

  describe('merge', () => {
    const dag = (strategy: 'all' | 'any') =>
      definition(
        [trigger(), mock('fast'), mock('slow'), merge('join', strategy), mock('after')],
        [
          edge('trigger', 'fast'),
          edge('trigger', 'slow'),
          edge('fast', 'join'),
          edge('slow', 'join'),
          edge('join', 'after'),
        ],
      );
    const behavior: MockBehavior = async (input, attempt) => {
      await new Promise((resolve) => setTimeout(resolve, input.nodeId === 'slow' ? 600 : 0));
      return { output: { ok: true }, attempts: attempt };
    };

    it('merge all waits for every executed branch', async () => {
      const { result, harness } = await execute(dag('all'), { behavior });
      expect((result as ExecuteDagResult).status).toBe('succeeded');
      expect(indexOf(harness, 'step.succeeded', 'join')).toBeGreaterThan(
        indexOf(harness, 'step.succeeded', 'slow'),
      );
    });

    it('merge any continues on the first branch without waiting for the others', async () => {
      const { result, harness } = await execute(dag('any'), { behavior });
      expect((result as ExecuteDagResult).status).toBe('succeeded');
      const join = indexOf(harness, 'step.succeeded', 'join');
      const after = indexOf(harness, 'step.succeeded', 'after');
      const slow = indexOf(harness, 'step.succeeded', 'slow');
      expect(join).toBeGreaterThan(indexOf(harness, 'step.succeeded', 'fast'));
      expect(join).toBeLessThan(slow);
      expect(after).toBeLessThan(slow);
      // The run still waits for the slow branch before it finishes.
      expect(stepEvents(harness, 'step.succeeded')).toContain('slow');
      expect(harness.events.at(-1)?.transition).toBe('run.finished');
    });
  });

  describe('failures', () => {
    const permanent: MockBehavior = (input, attempt) => {
      if (input.nodeId !== 'bad')
        return Promise.resolve({ output: { ok: true }, attempts: attempt });
      return Promise.reject(
        ApplicationFailure.create({
          type: 'MOCK_SERVICE_PERMANENT',
          message: 'The simulated service failed (permanent).',
          nonRetryable: true,
          details: [{ attempt }],
        }),
      );
    };

    it('retries a transient failure up to 3 attempts and records the attempts', async () => {
      const flaky: MockBehavior = (_input, attempt) => {
        if (attempt < 3) {
          return Promise.reject(
            ApplicationFailure.create({
              type: 'MOCK_SERVICE_TRANSIENT',
              message: 'transient',
              details: [{ attempt }],
            }),
          );
        }
        return Promise.resolve({ output: { ok: true }, attempts: attempt });
      };
      const dag = definition([trigger(), mock('a')], [edge('trigger', 'a')]);
      const { result, harness } = await execute(dag, { behavior: flaky });
      expect((result as ExecuteDagResult).status).toBe('succeeded');
      expect(harness.calls).toEqual(['a', 'a', 'a']);
      const done = harness.events.find(
        (e) => e.transition === 'step.succeeded' && e.nodeId === 'a',
      );
      expect(done).toMatchObject({ attempts: 3 });
    });

    it('fails fast: the failing node fails the run and the running branches are cancelled', async () => {
      const behavior: MockBehavior = async (input, attempt) => {
        if (input.nodeId === 'slow') {
          await new Promise((resolve) => setTimeout(resolve, 3_000));
          return { output: { ok: true }, attempts: attempt };
        }
        return permanent(input, attempt);
      };
      const dag = definition(
        [trigger(), mock('bad'), mock('slow'), mock('never')],
        [edge('trigger', 'bad'), edge('trigger', 'slow'), edge('slow', 'never')],
      );
      const { result, harness } = await execute(dag, { behavior });
      // The slow branch takes 3 s: the run ends long before it, because the branch is cancelled.
      expect(harness.elapsedMs).toBeLessThan(2_500);
      expect(result).toBeInstanceOf(WorkflowFailedError);
      expect(stepEvents(harness, 'step.failed')).toEqual(['bad']);
      expect(stepEvents(harness, 'step.cancelled')).toEqual(['slow']);
      expect(harness.calls).not.toContain('never');
      expect(stepEvents(harness, 'step.succeeded')).not.toContain('never');
      expect(harness.calls.filter((id) => id === 'bad')).toHaveLength(1);
      expect(finished(harness)).toMatchObject({
        status: 'failed',
        errorCode: 'MOCK_SERVICE_PERMANENT',
      });
      const failedStep = harness.events.find((e) => e.transition === 'step.failed');
      expect(failedStep).toMatchObject({
        nodeId: 'bad',
        errorCode: 'MOCK_SERVICE_PERMANENT',
        attempts: 1,
      });
    });

    it('fails the run when a condition cannot be evaluated', async () => {
      const dag = definition(
        [trigger(), condition('check', 5), mock('a')],
        [edge('trigger', 'check'), edge('check', 'a', 'true')],
      );
      const { result, harness } = await execute(dag, { triggerInput: { tone: 'sin monto' } });
      expect(result).toBeInstanceOf(WorkflowFailedError);
      expect(stepEvents(harness, 'step.failed')).toEqual(['check']);
      expect(finished(harness)).toMatchObject({
        status: 'failed',
        errorCode: 'REFERENCE_VALUE_MISSING',
      });
    });

    it('refuses a definition with nodes of later phases', async () => {
      const dag = definition(
        [
          trigger(),
          node('ask', 'llm.generate', { instruction: 'x', language: 'es', maxLength: 1 }),
        ],
        [edge('trigger', 'ask')],
      );
      const { result, harness } = await execute(dag);
      expect(result).toBeInstanceOf(WorkflowFailedError);
      expect(harness.calls).toEqual([]);
      expect(finished(harness)).toMatchObject({ status: 'failed', errorCode: 'UNSUPPORTED_NODES' });
    });

    it('refuses an invalid definition', async () => {
      const { result, harness } = await execute({
        schemaVersion: 1,
        nodes: 'x',
        edges: [],
      } as never);
      expect(result).toBeInstanceOf(WorkflowFailedError);
      expect(finished(harness)).toMatchObject({
        status: 'failed',
        errorCode: 'INVALID_DEFINITION',
      });
    });
  });

  describe('duration and cancellation', () => {
    const hang: MockBehavior = async (_input, attempt) => {
      await new Promise((resolve) => setTimeout(resolve, 4_000));
      return { output: { ok: true }, attempts: attempt };
    };
    const dag = definition([trigger(), mock('slow')], [edge('trigger', 'slow')]);

    it('ends as timed_out when the run exceeds its maximum duration', async () => {
      const { result, harness } = await execute(dag, { behavior: hang, maxDurationMs: 800 });
      expect(result).toBeInstanceOf(WorkflowFailedError);
      expect(finished(harness)).toMatchObject({ status: 'timed_out', errorCode: 'RUN_TIMED_OUT' });
      expect(stepEvents(harness, 'step.cancelled')).toEqual(['slow']);
    });

    it('ends as cancelled and cancels the running node when the client cancels the run', async () => {
      const { result, harness } = await execute(dag, {
        behavior: hang,
        during: async (handle, h) => {
          while (!h.calls.includes('slow')) await new Promise((r) => setTimeout(r, 50));
          await handle.cancel();
        },
      });
      expect(result).toBeInstanceOf(WorkflowFailedError);
      expect(finished(harness)).toMatchObject({ status: 'cancelled' });
      expect(stepEvents(harness, 'step.cancelled')).toEqual(['slow']);
    });
  });

  it('validates its input with the contract', async () => {
    const taskQueue = `test-${randomUUID()}`;
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowsPath,
      activities: {
        recordRunEvent: () => Promise.resolve(),
        mockService: () => Promise.reject(new Error('unused')),
      },
    });
    const error = await worker.runUntil(
      env.client.workflow
        .execute<ExecuteDagWorkflow>(EXECUTE_DAG_WORKFLOW_NAME, {
          taskQueue,
          workflowId: `run-${randomUUID()}`,
          args: [{ nope: true }],
        })
        .catch((e: unknown) => e),
    );
    expect(error).toBeInstanceOf(WorkflowFailedError);
  });
});
