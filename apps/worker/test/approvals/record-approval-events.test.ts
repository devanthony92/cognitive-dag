import { randomUUID } from 'node:crypto';
import Valkey from 'iovalkey';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseClient } from '@cognitive-dag/db';
import { createLogger } from '@cognitive-dag/logger';
import type { RunEvent } from '@cognitive-dag/contracts';
import {
  createRunEventActivities,
  type RunEventActivities,
} from '../../src/activities/record-run-event';
import { parseEnv } from '../../src/config/env.schema';
import { loadLocalEnv } from '../../src/config/load-env';
import { readRun, seedRun, type SeededRun } from '../integration/support/seed';

loadLocalEnv();
const config = parseEnv(process.env);

const EMPTY = { schemaVersion: 1, nodes: [], edges: [] };

describe('recordRunEvent with approvals (requires docker compose up)', () => {
  let database: DatabaseClient;
  let pool: pg.Pool;
  let valkey: Valkey;
  let activities: RunEventActivities;
  const published: Array<Record<string, unknown>> = [];

  beforeAll(() => {
    database = createDatabase({ connectionString: config.DATABASE_URL, max: 4 });
    pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
    valkey = new Valkey(config.VALKEY_URL);
    activities = createRunEventActivities({
      withContext: database.withContext,
      publish: (_channel, message) => {
        published.push(JSON.parse(message) as Record<string, unknown>);
        return Promise.resolve();
      },
      logger: createLogger({ component: 'worker-test', level: 'silent' }),
    });
  });

  afterAll(async () => {
    valkey.disconnect();
    await pool.end();
    await database.end();
  });

  const base = (run: SeededRun) => ({
    organizationId: run.organizationId,
    runId: run.runId,
    correlationId: randomUUID(),
    at: new Date().toISOString(),
  });

  const ref = { nodeId: 'ask', nodeType: 'human.approval' };

  async function approvalRows(run: SeededRun) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.organization_id', $1, true)", [
        run.organizationId,
      ]);
      const { rows } = await client.query<{
        status: string;
        node_label: string;
        run_triggered_by: string | null;
        decided_by: string | null;
        has_comment: boolean;
        resolved_at: Date | null;
        expires_at: Date;
      }>(
        `SELECT status, node_label, run_triggered_by, decided_by, has_comment, resolved_at, expires_at
           FROM approvals WHERE run_id = $1`,
        [run.runId],
      );
      await client.query('COMMIT');
      return rows;
    } finally {
      client.release();
    }
  }

  async function addEditor(run: SeededRun): Promise<string> {
    const userId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.organization_id', $1, true)", [
        run.organizationId,
      ]);
      await client.query(
        'INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)',
        [userId, `ed-${userId}@example.test`, 'editor', '$argon2id$test'],
      );
      await client.query(
        "INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'editor')",
        [run.organizationId, userId],
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    return userId;
  }

  const requested = (run: SeededRun): RunEvent => ({
    ...base(run),
    transition: 'approval.requested',
    ...ref,
    nodeLabel: 'Aprobar pedido',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });

  it('creates the request once, copying the requester of the run', async () => {
    const run = await seedRun(pool, EMPTY);
    await activities.recordRunEvent(requested(run));
    await activities.recordRunEvent(requested(run));
    const rows = await approvalRows(run);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'pending',
      node_label: 'Aprobar pedido',
      run_triggered_by: run.userId,
      decided_by: null,
      has_comment: false,
    });
    expect(published.at(-1)).toMatchObject({ transition: 'approval.requested', nodeId: 'ask' });
  });

  it('closes the request with the decision, and a repeated or late event changes nothing', async () => {
    const run = await seedRun(pool, EMPTY);
    const editor = await addEditor(run);
    await activities.recordRunEvent(requested(run));
    const resolved: RunEvent = {
      ...base(run),
      transition: 'approval.resolved',
      ...ref,
      outcome: 'approved',
      decidedBy: editor,
      hasComment: true,
    };
    await activities.recordRunEvent(resolved);
    await activities.recordRunEvent(resolved);
    await activities.recordRunEvent({
      ...base(run),
      transition: 'approval.resolved',
      ...ref,
      outcome: 'timed_out',
      hasComment: false,
    });
    const rows = await approvalRows(run);
    expect(rows[0]).toMatchObject({ status: 'approved', decided_by: editor, has_comment: true });
    expect(rows[0]?.resolved_at).toBeInstanceOf(Date);
  });

  it.each(['timed_out', 'cancelled'] as const)(
    'closes a %s request without a decider',
    async (outcome) => {
      const run = await seedRun(pool, EMPTY);
      await activities.recordRunEvent(requested(run));
      await activities.recordRunEvent({
        ...base(run),
        transition: 'approval.resolved',
        ...ref,
        outcome,
        hasComment: false,
      });
      expect((await approvalRows(run))[0]).toMatchObject({ status: outcome, decided_by: null });
    },
  );

  it('the database refuses the initiator as the decider (decision 7A, defense in depth)', async () => {
    const run = await seedRun(pool, EMPTY);
    await activities.recordRunEvent(requested(run));
    await expect(
      activities.recordRunEvent({
        ...base(run),
        transition: 'approval.resolved',
        ...ref,
        outcome: 'approved',
        decidedBy: run.userId,
        hasComment: false,
      }),
    ).rejects.toThrow();
    expect((await approvalRows(run))[0]).toMatchObject({ status: 'pending' });
  });

  it('records the waiting reason of the step and its live event', async () => {
    const run = await seedRun(pool, EMPTY);
    await activities.recordRunEvent({
      ...base(run),
      transition: 'run.started',
      nodes: [ref],
    });
    await activities.recordRunEvent({
      ...base(run),
      transition: 'step.running',
      ...ref,
      waitingReason: 'approval',
    });
    expect((await readRun(pool, run)).steps[0]).toMatchObject({
      node_id: 'ask',
      status: 'running',
      waiting_reason: 'approval',
    });
    expect(published.at(-1)).toMatchObject({ stepStatus: 'running', waitingReason: 'approval' });
    await activities.recordRunEvent({
      ...base(run),
      transition: 'step.succeeded',
      ...ref,
      durationMs: 5,
    });
    expect((await readRun(pool, run)).steps[0]).toMatchObject({
      status: 'succeeded',
      waiting_reason: null,
    });
  });

  it('records the circuit_open waiting reason too', async () => {
    const run = await seedRun(pool, EMPTY);
    await activities.recordRunEvent({
      ...base(run),
      transition: 'run.started',
      nodes: [{ nodeId: 'call', nodeType: 'http.request' }],
    });
    await activities.recordRunEvent({
      ...base(run),
      transition: 'step.running',
      nodeId: 'call',
      nodeType: 'http.request',
      waitingReason: 'circuit_open',
    });
    expect((await readRun(pool, run)).steps[0]).toMatchObject({ waiting_reason: 'circuit_open' });
  });
});
