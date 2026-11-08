import { randomUUID } from 'node:crypto';
import { ScheduleNotFoundError, ScheduleOverlapPolicy } from '@temporalio/client';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIRE_SCHEDULE_WORKFLOW_NAME, scheduleIdFor } from '@cognitive-dag/contracts';
import { createDatabase, type DatabaseClient } from '@cognitive-dag/db';
import { createLogger } from '@cognitive-dag/logger';
import { parseEnv } from '../../src/config/env.schema';
import { loadLocalEnv } from '../../src/config/load-env';
import {
  buildScheduleOptions,
  createScheduleReconciler,
  type ScheduleReconciler,
} from '../../src/schedules/reconciler';
import { seedRun, type SeededRun } from '../integration/support/seed';

loadLocalEnv();
const config = parseEnv(process.env);
const logger = createLogger({ component: 'worker-test', level: 'silent' });
const EMPTY = { schemaVersion: 1, nodes: [], edges: [] };
const TASK_QUEUE = 'cognitive-dag-test';
const CATCHUP_SECONDS = 3600;

describe('schedule reconciler (requires docker compose up)', () => {
  let env: TestWorkflowEnvironment;
  let database: DatabaseClient;
  let pool: pg.Pool;
  let reconciler: ScheduleReconciler;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createLocal();
    database = createDatabase({ connectionString: config.DATABASE_URL, max: 4 });
    pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
    reconciler = build();
  }, 120_000);

  afterAll(async () => {
    await pool.end();
    await database.end();
    await env?.teardown();
  });

  function build(overrides: Partial<Parameters<typeof createScheduleReconciler>[0]> = {}) {
    return createScheduleReconciler({
      withContext: database.withContext,
      client: env.client,
      taskQueue: TASK_QUEUE,
      catchupWindowSeconds: CATCHUP_SECONDS,
      triggersEnabled: true,
      logger,
      ...overrides,
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
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function schedule(cron = '0 9 * * *', timezone = 'America/Bogota'): Promise<SeededRun> {
    const run = await seedRun(pool, EMPTY);
    await inOrg(run, (client) =>
      client.query(
        `INSERT INTO workflow_schedules (organization_id, workflow_id, version_id, cron, timezone)
         VALUES ($1, $2, $3, $4, $5)`,
        [run.organizationId, run.workflowId, run.versionId, cron, timezone],
      ),
    );
    return run;
  }

  const rowOf = (run: SeededRun) =>
    inOrg(run, async (client) => {
      const { rows } = await client.query(
        `SELECT desired_state, sync_status, sync_attempts, last_error_code, synced_at
           FROM workflow_schedules WHERE workflow_id = $1`,
        [run.workflowId],
      );
      return rows[0] as {
        desired_state: string;
        sync_status: string;
        sync_attempts: number;
        last_error_code: string | null;
        synced_at: Date | null;
      };
    });

  const exists = async (run: SeededRun) => {
    try {
      await env.client.schedule.getHandle(scheduleIdFor(run.workflowId)).describe();
      return true;
    } catch (error) {
      if (error instanceof ScheduleNotFoundError) return false;
      throw error;
    }
  };

  /** Only the rows of the test count: other tests share the database. */
  async function reconcile(r: ScheduleReconciler = reconciler) {
    return r.reconcileOnce();
  }

  it('creates the Temporal Schedule with SKIP on overlap and the catch-up window', async () => {
    const run = await schedule();
    await reconcile();
    expect(await rowOf(run)).toMatchObject({
      sync_status: 'synced',
      last_error_code: null,
      sync_attempts: 0,
    });
    const description = await env.client.schedule
      .getHandle(scheduleIdFor(run.workflowId))
      .describe();
    expect(description.policies.overlap).toBe(ScheduleOverlapPolicy.SKIP);
    expect(description.policies.catchupWindow).toBe(CATCHUP_SECONDS * 1000);
    expect(description.spec.timezone).toBe('America/Bogota');
    expect(description.action).toMatchObject({
      type: 'startWorkflow',
      workflowType: FIRE_SCHEDULE_WORKFLOW_NAME,
      taskQueue: TASK_QUEUE,
      args: [{ organizationId: run.organizationId, workflowId: run.workflowId }],
    });
    await env.client.schedule.getHandle(scheduleIdFor(run.workflowId)).delete();
  });

  it('builds the options the data model asks for', () => {
    const options = buildScheduleOptions(
      {
        organizationId: randomUUID(),
        workflowId: randomUUID(),
        cron: '*/5 * * * *',
        timezone: 'UTC',
      },
      { taskQueue: TASK_QUEUE, catchupWindowSeconds: 120 },
    );
    expect(options.policies).toEqual({
      overlap: ScheduleOverlapPolicy.SKIP,
      catchupWindow: '120 seconds',
    });
    expect(options.spec).toEqual({ cronExpressions: ['*/5 * * * *'], timezone: 'UTC' });
  });

  it('updates an existing Schedule instead of failing, and is idempotent', async () => {
    const run = await schedule();
    await reconcile();
    await inOrg(run, (client) =>
      client.query(
        `UPDATE workflow_schedules SET cron = '30 6 * * 1', timezone = 'UTC', sync_status = 'pending',
                synced_at = NULL WHERE workflow_id = $1`,
        [run.workflowId],
      ),
    );
    await reconcile();
    expect(await rowOf(run)).toMatchObject({ sync_status: 'synced' });
    const handle = env.client.schedule.getHandle(scheduleIdFor(run.workflowId));
    expect((await handle.describe()).spec.timezone).toBe('UTC');
    // A second pass has nothing to do for this row.
    const again = await reconcile();
    expect(again.failed).toBe(0);
    await handle.delete();
  });

  it('deletes the Schedule when the desired state is removed; a missing one is not an error', async () => {
    const run = await schedule();
    await reconcile();
    expect(await exists(run)).toBe(true);
    await inOrg(run, (client) =>
      client.query(
        `UPDATE workflow_schedules SET desired_state = 'removed', sync_status = 'pending',
                synced_at = NULL WHERE workflow_id = $1`,
        [run.workflowId],
      ),
    );
    await reconcile();
    expect(await exists(run)).toBe(false);
    expect(await rowOf(run)).toMatchObject({ desired_state: 'removed', sync_status: 'synced' });

    // Removing what Temporal never had.
    const never = await schedule();
    await inOrg(never, (client) =>
      client.query(
        `UPDATE workflow_schedules SET desired_state = 'removed' WHERE workflow_id = $1`,
        [never.workflowId],
      ),
    );
    await reconcile();
    expect(await rowOf(never)).toMatchObject({ sync_status: 'synced' });
  });

  it('retries a failed row and records the failure without detail', async () => {
    const run = await schedule();
    let fail = true;
    const flaky = build({
      client: {
        schedule: new Proxy(env.client.schedule, {
          get(target, property, receiver) {
            if (property === 'create' && fail) {
              return () => Promise.reject(new Error('Temporal unavailable'));
            }
            if (property === 'getHandle') {
              return (id: string) => {
                const handle = target.getHandle(id);
                return fail
                  ? { ...handle, update: () => Promise.reject(new ScheduleNotFoundError('x', id)) }
                  : handle;
              };
            }
            return Reflect.get(target, property, receiver) as unknown;
          },
        }),
      },
    });
    const first = await flaky.reconcileOnce();
    expect(first.failed).toBeGreaterThanOrEqual(1);
    expect(await rowOf(run)).toMatchObject({
      sync_status: 'failed',
      last_error_code: 'SCHEDULE_SYNC_FAILED',
      sync_attempts: 1,
    });
    fail = false;
    await flaky.reconcileOnce();
    expect(await rowOf(run)).toMatchObject({
      sync_status: 'synced',
      last_error_code: null,
      sync_attempts: 0,
    });
    expect(await exists(run)).toBe(true);
    await env.client.schedule.getHandle(scheduleIdFor(run.workflowId)).delete();
  });

  it('keeps the row pending when the wanted state changed while Temporal was updated', async () => {
    const run = await schedule();
    const racing = build({
      client: {
        schedule: new Proxy(env.client.schedule, {
          get(target, property, receiver) {
            if (property === 'create') {
              return async (options: Parameters<typeof target.create>[0]) => {
                // Someone changes the wanted state right after the row was read.
                await inOrg(run, (client) =>
                  client.query(
                    `UPDATE workflow_schedules SET cron = '0 12 * * *' WHERE workflow_id = $1`,
                    [run.workflowId],
                  ),
                );
                return target.create(options);
              };
            }
            return Reflect.get(target, property, receiver) as unknown;
          },
        }),
      },
    });
    await racing.reconcileOnce();
    expect(await rowOf(run)).toMatchObject({ sync_status: 'pending' });
    await reconciler.reconcileOnce();
    expect(await rowOf(run)).toMatchObject({ sync_status: 'synced' });
    await env.client.schedule.getHandle(scheduleIdFor(run.workflowId)).delete();
  });

  it('does nothing while triggers are disabled (the Schedules stay as they are)', async () => {
    const run = await schedule();
    const result = await build({ triggersEnabled: false }).reconcileOnce();
    expect(result).toEqual({ synced: 0, failed: 0 });
    expect(await rowOf(run)).toMatchObject({ sync_status: 'pending' });
    await reconcile();
    await env.client.schedule.getHandle(scheduleIdFor(run.workflowId)).delete();
  });

  it('a manual trigger of the Schedule fires the launcher with the ids of the workflow', async () => {
    const run = await schedule('0 0 1 1 *', 'UTC');
    await reconcile();
    const handle = env.client.schedule.getHandle(scheduleIdFor(run.workflowId));
    await handle.trigger();
    let actions = 0;
    for (let i = 0; i < 40 && actions === 0; i++) {
      actions = (await handle.describe()).info.numActionsTaken;
      if (actions === 0) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(actions).toBe(1);
    await handle.delete();
  });
});
