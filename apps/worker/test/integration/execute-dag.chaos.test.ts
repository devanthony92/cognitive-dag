import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Client, Connection } from '@temporalio/client';
import { NativeConnection } from '@temporalio/worker';
import Valkey from 'iovalkey';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseClient } from '@cognitive-dag/db';
import {
  EXECUTE_DAG_WORKFLOW_NAME,
  RUN_EXECUTION_TIMEOUT,
  type ExecuteDagInput,
  type ExecuteDagResult,
} from '@cognitive-dag/contracts';
import { parseEnv } from '../../src/config/env.schema';
import { loadLocalEnv } from '../../src/config/load-env';
import { createWorker } from '../../src/worker';
import { definition, edge, mock, trigger } from '../helpers/dags';
import { readRun, seedRun } from './support/seed';

loadLocalEnv();
const config = parseEnv(process.env);

describe('executeDag chaos: worker killed mid-node (requires docker compose up)', () => {
  const taskQueue = `test-${randomUUID()}`;
  let connection: Connection;
  let native: NativeConnection;
  let client: Client;
  let database: DatabaseClient;
  let pool: pg.Pool;
  let valkey: Valkey;

  beforeAll(async () => {
    connection = await Connection.connect({ address: config.TEMPORAL_ADDRESS });
    native = await NativeConnection.connect({ address: config.TEMPORAL_ADDRESS });
    client = new Client({ connection, namespace: config.TEMPORAL_NAMESPACE });
    database = createDatabase({ connectionString: config.DATABASE_URL, max: 4 });
    pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
    valkey = new Valkey(config.VALKEY_URL);
    valkey.on('error', () => undefined);
  });

  afterAll(async () => {
    valkey.disconnect();
    await pool.end();
    await database.end();
    await native.close();
    await connection.close();
  });

  it('finishes the run after SIGKILL without repeating the nodes that had finished', async () => {
    // trigger -> a (instant) -> b (slow: the worker dies here) -> c (instant)
    const dag = definition(
      [trigger(), mock('a'), mock('b', { latencyMs: 6_000 }), mock('c')],
      [edge('trigger', 'a'), edge('a', 'b'), edge('b', 'c')],
    );
    const seeded = await seedRun(pool, dag);
    const input: ExecuteDagInput = {
      organizationId: seeded.organizationId,
      workflowId: seeded.workflowId,
      versionId: seeded.versionId,
      versionNumber: 1,
      runId: seeded.runId,
      correlationId: randomUUID(),
      definition: dag,
      triggerInput: { amount: 150, tone: 'happy' },
    };

    const child = spawn(
      process.execPath,
      ['--import', 'tsx', path.resolve(__dirname, 'fixtures/crash-run-worker.ts')],
      {
        cwd: path.resolve(__dirname, '../..'),
        stdio: 'ignore',
        env: {
          ...process.env,
          TEMPORAL_ADDRESS: config.TEMPORAL_ADDRESS,
          TEMPORAL_NAMESPACE: config.TEMPORAL_NAMESPACE,
          TASK_QUEUE: taskQueue,
          WORKER_ID: 'worker-crashed',
        },
      },
    );
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));

    const handle = await client.workflow.start<(i: ExecuteDagInput) => Promise<ExecuteDagResult>>(
      EXECUTE_DAG_WORKFLOW_NAME,
      {
        taskQueue,
        workflowId: `run-${input.runId}`,
        args: [input],
        workflowExecutionTimeout: RUN_EXECUTION_TIMEOUT,
      },
    );

    try {
      // Wait until `a` is recorded as done and `b` runs in the child, then kill it without cleanup.
      const deadline = Date.now() + 40_000;
      for (;;) {
        const { raw } = await handle.describe();
        const running = raw.pendingActivities?.some((activity) => activity.lastStartedTime);
        const steps = (await readRun(pool, seeded)).steps;
        const a = steps.find((s) => s.node_id === 'a')?.status;
        const b = steps.find((s) => s.node_id === 'b')?.status;
        if (running && a === 'succeeded' && b === 'running') break;
        if (Date.now() > deadline) throw new Error('Node b never started in the child worker');
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } finally {
      child.kill('SIGKILL');
      await exited;
    }

    const second = await createWorker({
      connection: native,
      namespace: config.TEMPORAL_NAMESPACE,
      taskQueue,
      workerId: 'worker-b',
      activityDelayMs: 0,
      nodeEnv: 'test',
      shutdownGraceTime: '100ms',
      runs: {
        withContext: database.withContext,
        publish: (channel, message) => valkey.publish(channel, message),
      },
    });
    const secondRun = second.run();
    try {
      const result = await handle.result();
      expect(result.status).toBe('succeeded');

      // Each node ran once as far as the history is concerned: a and c are not repeated and b,
      // interrupted by the kill, was retried by Temporal, not rescheduled by the interpreter.
      const history = await handle.fetchHistory();
      const events = history.events ?? [];
      const scheduled = events.filter((e) => e.activityTaskScheduledEventAttributes);
      const mockScheduled = scheduled.filter(
        (e) => e.activityTaskScheduledEventAttributes?.activityType?.name === 'mockService',
      );
      expect(mockScheduled).toHaveLength(3);
      const completedIds = new Set(
        events
          .filter((e) => e.activityTaskCompletedEventAttributes)
          .map((e) => String(e.activityTaskCompletedEventAttributes?.scheduledEventId)),
      );
      for (const event of mockScheduled) expect(completedIds.has(String(event.eventId))).toBe(true);

      const state = await readRun(pool, seeded);
      expect(state.run?.status).toBe('succeeded');
      const byNode = Object.fromEntries(state.steps.map((s) => [s.node_id, s]));
      for (const id of ['trigger', 'a', 'b', 'c']) expect(byNode[id]?.status, id).toBe('succeeded');
      expect(byNode['a']?.attempts).toBe(1);
      expect(byNode['c']?.attempts).toBe(1);
      // The attempt interrupted by the kill counts: b finished on its second attempt.
      expect(byNode['b']?.attempts).toBeGreaterThanOrEqual(2);
    } finally {
      second.shutdown();
      await secondRun;
    }
  }, 120_000);
});
