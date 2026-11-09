import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DECIDE_APPROVAL_UPDATE_NAME,
  type DecideApprovalUpdateInput,
  type DecideApprovalUpdateResult,
} from '@cognitive-dag/contracts';
import { createHttpWorker, createWorker } from '../../src/worker';
import { definition, edge, mock, node, trigger } from '../helpers/dags';
import { readRun, type SeededRun } from '../integration/support/seed';
import { startLocalServer, type LocalServer } from '../support/f7';
import {
  openHarness,
  resultOf,
  spawnWorker,
  startRun,
  waitUntil,
  type Harness,
} from './support/harness';

// SC-004: a worker killed while an approval is pending, or while an HTTP node waits for its
// destination, loses nothing: the replacement continues and the decision still works.

describe('chaos: worker killed with F7 nodes in flight (requires docker compose up)', () => {
  let h: Harness;
  let server: LocalServer;
  let holdFirst = false;
  let held = 0;

  beforeAll(async () => {
    h = await openHarness();
    server = await startLocalServer((_request, response) => {
      if (holdFirst && held === 0) {
        // The first request is never answered: its worker is killed while it waits.
        held += 1;
        return;
      }
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('ok');
    });
  });

  afterAll(async () => {
    await server?.close();
    await h.close();
  });

  /** The workers of this process: the main queue with the F7 activities and the HTTP queue. */
  async function startF7Workers(taskQueue: string, httpQueue: string) {
    const main = await createWorker({
      connection: h.native,
      namespace: h.config.TEMPORAL_NAMESPACE,
      taskQueue,
      workerId: 'worker-b',
      activityDelayMs: 0,
      nodeEnv: 'test',
      shutdownGraceTime: '100ms',
      runs: {
        withContext: h.database.withContext,
        publish: (channel, message) => h.valkey.publish(channel, message),
        valkey: h.valkey,
      },
      triggers: {
        triggersOn: true,
        llmEnabled: false,
        llmTaskQueue: 'unused',
        httpTaskQueue: httpQueue,
        mailer: { send: () => Promise.resolve(), close: () => undefined },
        approvalMaxRecipients: 20,
      },
    });
    const http = await createHttpWorker({
      connection: h.native,
      namespace: h.config.TEMPORAL_NAMESPACE,
      taskQueue: httpQueue,
      shutdownGraceTime: '100ms',
      withContext: h.database.withContext,
      valkey: h.valkey,
      enabled: true,
      masterKey: undefined,
      breaker: { failures: 5, windowSeconds: 60, cooldownSeconds: 2, maxWaitSeconds: 120 },
      maxConcurrentActivities: 5,
      allowLoopback: true,
      tls: { ca: server.ca },
    });
    const running = Promise.all([main.run(), http.run()]);
    return {
      async stop() {
        main.shutdown();
        http.shutdown();
        await running;
      },
    };
  }

  async function addEditor(seeded: SeededRun): Promise<string> {
    const userId = randomUUID();
    const client = await h.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.organization_id', $1, true)", [
        seeded.organizationId,
      ]);
      await client.query(
        'INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)',
        [userId, `chaos-${userId}@example.test`, 'editor', '$argon2id$test'],
      );
      await client.query(
        "INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'editor')",
        [seeded.organizationId, userId],
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    return userId;
  }

  async function approvalOf(seeded: SeededRun) {
    const client = await h.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.organization_id', $1, true)", [
        seeded.organizationId,
      ]);
      const { rows } = await client.query<{ status: string; decided_by: string | null }>(
        'SELECT status, decided_by FROM approvals WHERE run_id = $1',
        [seeded.runId],
      );
      await client.query('COMMIT');
      return rows[0];
    } finally {
      client.release();
    }
  }

  it('keeps a pending approval across a SIGKILL and accepts the decision afterwards', async () => {
    const taskQueue = `chaos-${randomUUID()}`;
    const httpQueue = `chaos-http-${randomUUID()}`;
    const dag = definition(
      [
        trigger(),
        node('ask', 'human.approval', { message: 'Aprobar', timeoutSeconds: 3600 }),
        mock('go'),
      ],
      [edge('trigger', 'ask'), edge('ask', 'go', 'approved')],
    );
    const child = spawnWorker(h, taskQueue, 'worker-crashed', { HTTP_TASK_QUEUE: httpQueue });
    let second: { stop(): Promise<void> } | undefined;
    try {
      const { seeded, handle } = await startRun(h, taskQueue, dag, {
        executablePhases: ['F3', 'F7'],
        httpTaskQueue: httpQueue,
      });
      await waitUntil(
        async () => (await approvalOf(seeded))?.status === 'pending',
        'the approval to be requested',
        40_000,
      );
      await child.kill();
      const editor = await addEditor(seeded);
      second = await startF7Workers(taskQueue, httpQueue);

      // Still pending after the kill, and the decision reaches the workflow on the new worker.
      expect((await approvalOf(seeded))?.status).toBe('pending');
      await waitUntil(
        async () =>
          (
            await handle.executeUpdate<DecideApprovalUpdateResult, [DecideApprovalUpdateInput]>(
              DECIDE_APPROVAL_UPDATE_NAME,
              { args: [{ nodeId: 'ask', decision: 'approved', decidedBy: editor }] },
            )
          ).accepted === true,
        'the decision to be accepted',
        30_000,
      );
      const result = await resultOf(handle);
      expect(result.status).toBe('succeeded');
      expect(await approvalOf(seeded)).toMatchObject({ status: 'approved', decided_by: editor });
      const state = await readRun(h.pool, seeded);
      expect(state.run?.status).toBe('succeeded');
      expect(state.steps.find((s) => s.node_id === 'go')?.status).toBe('succeeded');
    } finally {
      await child.kill().catch(() => undefined);
      await second?.stop();
    }
  });

  it('retries an HTTP node killed while it waits for the destination, with the same Idempotency-Key', async () => {
    const taskQueue = `chaos-${randomUUID()}`;
    const httpQueue = `chaos-http-${randomUUID()}`;
    holdFirst = true;
    held = 0;
    const before = server.requests.length;
    const dag = definition(
      [
        node('hook', 'trigger.webhook', { bodySchema: [] }),
        {
          ...node('call', 'http.request', {
            method: 'POST',
            url: server.url('/chaos'),
            headers: {},
            body: '{}',
          }),
          retry: { maxAttempts: 3, timeoutSeconds: 5, initialIntervalMs: 100 },
        },
        mock('done'),
      ],
      [edge('hook', 'call'), edge('call', 'done')],
    );
    const child = spawnWorker(h, taskQueue, 'worker-crashed', {
      HTTP_TASK_QUEUE: httpQueue,
      HTTP_TEST_CA: server.ca,
    });
    let second: { stop(): Promise<void> } | undefined;
    try {
      const { seeded, handle } = await startRun(h, taskQueue, dag, {
        executablePhases: ['F3', 'F7'],
        httpTaskQueue: httpQueue,
        triggerKind: 'webhook',
      });
      await waitUntil(
        () => Promise.resolve(server.requests.length > before),
        'the destination to receive the request',
        40_000,
      );
      await child.kill();
      second = await startF7Workers(taskQueue, httpQueue);

      const result = await resultOf(handle);
      expect(result.status).toBe('succeeded');
      const calls = server.requests.slice(before);
      expect(calls.length).toBeGreaterThanOrEqual(2);
      const keys = new Set(calls.map((call) => call.headers['idempotency-key']));
      expect(keys).toEqual(new Set([`${seeded.runId}:call`]));
      const state = await readRun(h.pool, seeded);
      expect(state.steps.find((s) => s.node_id === 'call')?.status).toBe('succeeded');
      expect(state.run?.status).toBe('succeeded');
    } finally {
      holdFirst = false;
      await child.kill().catch(() => undefined);
      await second?.stop();
    }
  });
});
