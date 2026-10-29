import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { WorkflowFailedError } from '@temporalio/client';
import type { Duration } from '@temporalio/common';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PING_EXECUTION_TIMEOUT,
  PING_WORKFLOW_NAME,
  type PingResult,
  type PingWorkflowInput,
} from '@cognitive-dag/contracts';

const workflowsPath = path.resolve(__dirname, '../../src/workflows');
const input: PingWorkflowInput = { correlationId: randomUUID(), message: 'hola' };

describe('pingWorkflow', () => {
  let env: TestWorkflowEnvironment;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createLocal();
  }, 120_000);

  afterAll(async () => {
    await env?.teardown();
  });

  async function run(
    pong: (input: PingWorkflowInput) => Promise<PingResult>,
    executionTimeout: Duration = PING_EXECUTION_TIMEOUT,
  ) {
    const taskQueue = `test-${randomUUID()}`;
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowsPath,
      activities: { pong },
    });
    return worker.runUntil(
      env.client.workflow.execute<(input: PingWorkflowInput) => Promise<PingResult>>(
        PING_WORKFLOW_NAME,
        {
          taskQueue,
          workflowId: `ping-${randomUUID()}`,
          args: [input],
          workflowExecutionTimeout: executionTimeout,
        },
      ),
    );
  }

  it('completes with the activity result', async () => {
    const expected: PingResult = { pong: 'hola', workerId: 'w-1', attempts: 1 };
    await expect(run(() => Promise.resolve(expected))).resolves.toEqual(expected);
  });

  it('retries a failing activity and succeeds on the third attempt', async () => {
    let calls = 0;
    const result = await run(() => {
      calls += 1;
      if (calls < 3) return Promise.reject(new Error('transient'));
      return Promise.resolve({ pong: 'ok', workerId: 'w-1', attempts: calls });
    });
    expect(calls).toBe(3);
    expect(result.attempts).toBe(3);
  });

  it('fails after three attempts', async () => {
    let calls = 0;
    await expect(
      run(() => {
        calls += 1;
        return Promise.reject(new Error('always fails'));
      }),
    ).rejects.toBeInstanceOf(WorkflowFailedError);
    expect(calls).toBe(3);
  });

  it('times out when the execution exceeds the global timeout', async () => {
    // The activity outlives the limit, so only the global timeout can end it.
    // The production limit is 10 minutes; a short one keeps the test fast without time skipping.
    const stuck = () =>
      new Promise<PingResult>((resolve) =>
        setTimeout(() => resolve({ pong: 'late', workerId: 'w-1', attempts: 1 }), 4_000),
      );
    const error = await run(stuck, '3 seconds').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WorkflowFailedError);
    expect((error as WorkflowFailedError).cause?.name).toBe('TimeoutFailure');
  }, 30_000);
});
