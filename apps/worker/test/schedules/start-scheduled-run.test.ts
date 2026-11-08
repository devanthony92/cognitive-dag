import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseClient } from '@cognitive-dag/db';
import { createLogger, type Logger } from '@cognitive-dag/logger';
import { parseEnv } from '../../src/config/env.schema';
import { loadLocalEnv } from '../../src/config/load-env';
import {
  createScheduleActivities,
  type ScheduleActivities,
  type StartScheduledRunInput,
} from '../../src/schedules/activities';
import { seedRun, type SeededRun } from '../integration/support/seed';

loadLocalEnv();
const config = parseEnv(process.env);

const SCHEDULED = {
  schemaVersion: 1,
  nodes: [
    {
      id: 'tick',
      type: 'trigger.schedule',
      label: 'Cada día',
      position: { x: 0, y: 0 },
      config: { cron: '0 9 * * *', timezone: 'UTC' },
    },
    {
      id: 'ask',
      type: 'human.approval',
      label: 'Aprobar',
      position: { x: 0, y: 0 },
      config: { message: 'ok', timeoutSeconds: 7200 },
    },
  ],
  edges: [{ id: 'e1', source: 'tick', sourceHandle: 'out', target: 'ask' }],
};

const MANUAL = {
  schemaVersion: 1,
  nodes: [
    {
      id: 'start',
      type: 'trigger.manual',
      label: 'Inicio',
      position: { x: 0, y: 0 },
      config: { inputSchema: [] },
    },
  ],
  edges: [],
};

describe('startScheduledRun (requires docker compose up)', () => {
  let database: DatabaseClient;
  let pool: pg.Pool;
  const warnings: Array<Record<string, unknown>> = [];

  beforeAll(() => {
    database = createDatabase({ connectionString: config.DATABASE_URL, max: 4 });
    pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
  });

  afterAll(async () => {
    await pool.end();
    await database.end();
  });

  const logger = (): Logger => {
    const base = createLogger({ component: 'worker-test', level: 'silent' });
    const wrapped = {
      ...base,
      child: () => wrapped,
      warn: (fields: Record<string, unknown>) => warnings.push(fields),
    };
    return wrapped as unknown as Logger;
  };

  function activities(
    overrides: { triggersEnabled?: boolean; llmEnabled?: boolean } = {},
  ): ScheduleActivities {
    return createScheduleActivities({
      withContext: database.withContext,
      logger: logger(),
      triggersEnabled: overrides.triggersEnabled ?? true,
      llmEnabled: overrides.llmEnabled ?? false,
      llmTaskQueue: 'llm-q',
      httpTaskQueue: 'http-q',
    });
  }

  async function inOrg<T>(run: SeededRun, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.organization_id', $1, true)", [
        run.organizationId,
      ]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } finally {
      client.release();
    }
  }

  async function activate(run: SeededRun, versionId: string | null = run.versionId) {
    await inOrg(run, async (client) => {
      await client.query(
        `INSERT INTO workflow_active_versions (workflow_id, organization_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [run.workflowId, run.organizationId],
      );
      if (versionId) {
        await client.query(
          `UPDATE workflow_active_versions SET version_id = $2, activated_by = $3, activated_at = now()
           WHERE workflow_id = $1`,
          [run.workflowId, versionId, run.userId],
        );
      }
    });
  }

  const runsOf = (run: SeededRun) =>
    inOrg(run, async (client) => {
      const { rows } = await client.query(
        `SELECT id, version_id, trigger_kind, triggered_by, scheduled_at, status
           FROM workflow_runs WHERE workflow_id = $1 AND trigger_kind = 'schedule'`,
        [run.workflowId],
      );
      return rows as Array<{
        id: string;
        version_id: string;
        trigger_kind: string;
        triggered_by: string | null;
        scheduled_at: Date;
        status: string;
      }>;
    });

  const inputOf = (run: SeededRun): StartScheduledRunInput => ({
    organizationId: run.organizationId,
    workflowId: run.workflowId,
    scheduledAt: '2026-11-07T14:00:00.000Z',
    correlationId: randomUUID(),
  });

  it('creates a queued run of the active version at the moment of the firing', async () => {
    const run = await seedRun(pool, SCHEDULED);
    await activate(run);
    const result = await activities().startScheduledRun(inputOf(run));
    expect(result.status).toBe('started');
    if (result.status !== 'started') return;
    const [row] = await runsOf(run);
    expect(row).toMatchObject({
      id: result.runId,
      version_id: run.versionId,
      trigger_kind: 'schedule',
      triggered_by: null,
      status: 'queued',
    });
    expect(row!.scheduled_at.toISOString()).toBe('2026-11-07T14:00:00.000Z');
    expect(result.temporalWorkflowId).toBe(`run-${result.runId}`);
    expect(result.input).toMatchObject({
      runId: result.runId,
      versionId: run.versionId,
      triggerKind: 'schedule',
      scheduledAt: '2026-11-07T14:00:00.000Z',
      triggerInput: {},
      llmTaskQueue: 'llm-q',
      httpTaskQueue: 'http-q',
      executablePhases: ['F3', 'F7'],
    });
    // The duration and the hard timeout grow with the deadline of the approval (2 h).
    expect(result.input.maxDurationMs).toBe(30 * 60 * 1000 + 7_200_000);
    expect(result.executionTimeoutSeconds).toBe(30 * 60 + 7200 + 60);
  });

  it('adds F5 only when the LLM is on', async () => {
    const run = await seedRun(pool, SCHEDULED);
    await activate(run);
    const result = await activities({ llmEnabled: true }).startScheduledRun(inputOf(run));
    expect(result.status === 'started' && result.input.executablePhases).toEqual([
      'F3',
      'F5',
      'F7',
    ]);
  });

  it('uses the version that is active when it fires, not the one scheduled earlier', async () => {
    const run = await seedRun(pool, SCHEDULED);
    await activate(run);
    const second = await inOrg(run, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO workflow_versions
           (organization_id, workflow_id, version_number, definition, definition_hash, node_count,
            edge_count, node_types, published_by)
         VALUES ($1, $2, 2, $3::jsonb, $4, 2, 1, ARRAY['trigger.schedule','human.approval'], $5)
         RETURNING id`,
        [
          run.organizationId,
          run.workflowId,
          JSON.stringify(SCHEDULED),
          Buffer.alloc(32, 7),
          run.userId,
        ],
      );
      return rows[0]!.id;
    });
    await activate(run, second);
    const result = await activities().startScheduledRun(inputOf(run));
    expect(result.status === 'started' && result.input.versionNumber).toBe(2);
  });

  it('skips and logs when triggers are disabled, creating no run', async () => {
    const run = await seedRun(pool, SCHEDULED);
    await activate(run);
    warnings.length = 0;
    const result = await activities({ triggersEnabled: false }).startScheduledRun(inputOf(run));
    expect(result).toEqual({ status: 'skipped', reason: 'triggers_disabled' });
    expect(await runsOf(run)).toHaveLength(0);
    expect(warnings.some((w) => w['event'] === 'schedule.skipped')).toBe(true);
  });

  it('skips when there is no active version', async () => {
    const run = await seedRun(pool, SCHEDULED);
    await activate(run, null);
    expect(await activities().startScheduledRun(inputOf(run))).toEqual({
      status: 'skipped',
      reason: 'no_active_version',
    });
    expect(await runsOf(run)).toHaveLength(0);
  });

  it('skips, and leaves no run, when the active version has no schedule trigger', async () => {
    const run = await seedRun(pool, MANUAL);
    await activate(run);
    expect(await activities().startScheduledRun(inputOf(run))).toEqual({
      status: 'skipped',
      reason: 'trigger_missing',
    });
    expect(await runsOf(run)).toHaveLength(0);
  });

  it('skips when the organization already has its runs in progress', async () => {
    const run = await seedRun(pool, SCHEDULED);
    await activate(run);
    // The platform default is 5 runs in progress and the seeded run is one of them.
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await activities().startScheduledRun(inputOf(run)));
    expect(results.filter((r) => r.status === 'started')).toHaveLength(4);
    expect(results.at(-1)).toEqual({ status: 'skipped', reason: 'run_limit_reached' });
  });
});
