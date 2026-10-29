import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Client, Connection } from '@temporalio/client';
import { NativeConnection } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PING_EXECUTION_TIMEOUT,
  PING_WORKFLOW_NAME,
  PingResultSchema,
  type PingWorkflowInput,
} from '@cognitive-dag/contracts';
import { parseEnv } from '../../src/config/env.schema';
import { loadLocalEnv } from '../../src/config/load-env';
import { createPingWorker } from '../../src/worker';

loadLocalEnv();
const config = parseEnv(process.env);

describe('ping chaos: worker lost mid-activity (requires docker compose up)', () => {
  const taskQueue = `test-${randomUUID()}`;
  let connection: Connection;
  let native: NativeConnection;
  let client: Client;

  beforeAll(async () => {
    connection = await Connection.connect({ address: config.TEMPORAL_ADDRESS });
    native = await NativeConnection.connect({ address: config.TEMPORAL_ADDRESS });
    client = new Client({ connection, namespace: config.TEMPORAL_NAMESPACE });
  });

  afterAll(async () => {
    await native.close();
    await connection.close();
  });

  const makeWorker = (workerId: string, delayMs: number) =>
    createPingWorker({
      connection: native,
      namespace: config.TEMPORAL_NAMESPACE,
      taskQueue,
      workerId,
      activityDelayMs: delayMs,
      nodeEnv: 'test',
      shutdownGraceTime: '100ms',
    });

  it('finishes with a single result when a second worker replaces the stopped one', async () => {
    const input: PingWorkflowInput = { correlationId: randomUUID() };
    const first = await makeWorker('worker-a', 4_000);
    const firstRun = first.run();

    const handle = await client.workflow.start(PING_WORKFLOW_NAME, {
      taskQueue,
      workflowId: `ping-${randomUUID()}`,
      args: [input],
      workflowExecutionTimeout: PING_EXECUTION_TIMEOUT,
    });

    // Let the activity begin, then take the worker away while it is sleeping.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    first.shutdown();
    await firstRun;

    const second = await makeWorker('worker-b', 0);
    const secondRun = second.run();
    try {
      const result = PingResultSchema.parse(await handle.result());
      expect(result.workerId).toBe('worker-b');
      expect(result.attempts).toBeGreaterThanOrEqual(2);

      const history = await handle.fetchHistory();
      const completed = history.events?.filter(
        (event) => event.activityTaskCompletedEventAttributes,
      );
      expect(completed).toHaveLength(1);
    } finally {
      second.shutdown();
      await secondRun;
    }
  }, 60_000);

  it('finishes with a single result after the worker process is killed with SIGKILL', async () => {
    const input: PingWorkflowInput = { correlationId: randomUUID() };
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', path.resolve(__dirname, 'fixtures/crash-worker.ts')],
      {
        cwd: path.resolve(__dirname, '../..'),
        stdio: 'ignore',
        env: {
          ...process.env,
          TEMPORAL_ADDRESS: config.TEMPORAL_ADDRESS,
          TEMPORAL_NAMESPACE: config.TEMPORAL_NAMESPACE,
          TASK_QUEUE: taskQueue,
          WORKER_ID: 'worker-crashed',
          ACTIVITY_DELAY_MS: '4000',
        },
      },
    );
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));

    const handle = await client.workflow.start(PING_WORKFLOW_NAME, {
      taskQueue,
      workflowId: `ping-${randomUUID()}`,
      args: [input],
      workflowExecutionTimeout: PING_EXECUTION_TIMEOUT,
    });

    try {
      // Wait until the activity is running in the child process, then kill it without cleanup.
      const deadline = Date.now() + 30_000;
      for (;;) {
        const { raw } = await handle.describe();
        if (raw.pendingActivities?.some((activity) => activity.lastStartedTime)) break;
        if (Date.now() > deadline) throw new Error('Activity never started in the child worker');
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } finally {
      child.kill('SIGKILL');
      await exited;
    }

    const second = await makeWorker('worker-b', 0);
    const secondRun = second.run();
    try {
      const result = PingResultSchema.parse(await handle.result());
      expect(result.workerId).toBe('worker-b');
      expect(result.attempts).toBeGreaterThanOrEqual(2);

      const history = await handle.fetchHistory();
      const completed = history.events?.filter(
        (event) => event.activityTaskCompletedEventAttributes,
      );
      expect(completed).toHaveLength(1);
    } finally {
      second.shutdown();
      await secondRun;
    }
  }, 60_000);
});
