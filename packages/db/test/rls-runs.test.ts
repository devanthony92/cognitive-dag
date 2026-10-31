import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTenant,
  expectSqlError,
  inContext,
  migratorPool,
  runtimePool,
  type Tenant,
} from './helpers.js';

const TABLES = ['workflow_runs', 'workflow_run_steps'] as const;

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';

const EMPTY = '{"schemaVersion":1,"nodes":[],"edges":[]}';

let pool: pg.Pool;
let migrator: pg.Pool;
let a: Tenant;
let b: Tenant;
let workflowA: string;
let workflowA2: string;
let workflowB: string;
let versionA: string;
let versionA2: string;
let versionB: string;
let runA: string;
let runB: string;

function ctx(tenant: Tenant) {
  return { userId: tenant.userId, organizationId: tenant.organizationId };
}

async function createWorkflow(tenant: Tenant, name: string): Promise<string> {
  return inContext(pool, ctx(tenant), async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO workflows (organization_id, name, draft_updated_by, created_by)
       VALUES ($1, $2, $3, $3) RETURNING id`,
      [tenant.organizationId, name, tenant.userId],
    );
    const id = rows[0]!.id;
    await client.query(
      'INSERT INTO workflow_active_versions (workflow_id, organization_id) VALUES ($1, $2)',
      [id, tenant.organizationId],
    );
    return id;
  });
}

async function publish(tenant: Tenant, workflowId: string): Promise<string> {
  return inContext(pool, ctx(tenant), async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO workflow_versions
         (organization_id, workflow_id, version_number, definition, definition_hash,
          node_count, edge_count, node_types, published_by)
       VALUES ($1, $2, 1, $3::jsonb, $4, 1, 0, ARRAY['trigger.manual'], $5) RETURNING id`,
      [
        tenant.organizationId,
        workflowId,
        EMPTY,
        createHash('sha256').update(EMPTY).digest(),
        tenant.userId,
      ],
    );
    return rows[0]!.id;
  });
}

interface RunOverrides {
  organizationId?: string;
  workflowId?: string;
  versionId?: string;
  status?: string;
  finishedAt?: string | null;
  cancelledBy?: string | null;
  rerunOf?: string | null;
  temporalWorkflowId?: string;
  errorMessage?: string | null;
  versionNumber?: number;
}

/** What the API does when it starts a run: one row, in `queued`, before Temporal is called. */
async function insertRun(
  client: pg.PoolClient,
  tenant: Tenant,
  workflowId: string,
  versionId: string,
  overrides: RunOverrides = {},
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO workflow_runs
       (id, organization_id, workflow_id, version_id, version_number, status, triggered_by,
        cancelled_by, rerun_of, correlation_id, temporal_workflow_id, error_message, finished_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      id,
      overrides.organizationId ?? tenant.organizationId,
      overrides.workflowId ?? workflowId,
      overrides.versionId ?? versionId,
      overrides.versionNumber ?? 1,
      overrides.status ?? 'queued',
      tenant.userId,
      overrides.cancelledBy ?? null,
      overrides.rerunOf ?? null,
      randomUUID(),
      overrides.temporalWorkflowId ?? `run-${id}`,
      overrides.errorMessage ?? null,
      overrides.finishedAt ?? null,
    ],
  );
  return id;
}

async function insertStep(
  client: pg.PoolClient,
  tenant: Tenant,
  runId: string,
  nodeId: string,
  extra: {
    organizationId?: string;
    nodeType?: string;
    attempts?: number;
    durationMs?: number;
  } = {},
): Promise<void> {
  await client.query(
    `INSERT INTO workflow_run_steps
       (organization_id, run_id, node_id, node_type, attempts, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      extra.organizationId ?? tenant.organizationId,
      runId,
      nodeId,
      extra.nodeType ?? 'mock.service',
      extra.attempts ?? 0,
      extra.durationMs ?? null,
    ],
  );
}

async function count(client: pg.PoolClient, table: string, where = 'true'): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    `SELECT count(*) AS n FROM ${table} WHERE ${where}`,
  );
  return Number(rows[0]!.n);
}

/** Runs a statement that must fail without aborting the surrounding transaction. */
async function failing(
  client: pg.PoolClient,
  run: () => Promise<unknown>,
  code: string,
): Promise<void> {
  await client.query('SAVEPOINT attempt');
  await expectSqlError(run(), code);
  await client.query('ROLLBACK TO SAVEPOINT attempt');
}

beforeAll(async () => {
  pool = runtimePool();
  migrator = migratorPool();
  a = await createTenant(pool, 'run-a');
  b = await createTenant(pool, 'run-b');
  workflowA = await createWorkflow(a, 'Flujo A');
  workflowA2 = await createWorkflow(a, 'Flujo A2');
  workflowB = await createWorkflow(b, 'Flujo B');
  versionA = await publish(a, workflowA);
  versionA2 = await publish(a, workflowA2);
  versionB = await publish(b, workflowB);
  runA = await inContext(pool, ctx(a), async (client) => {
    const id = await insertRun(client, a, workflowA, versionA);
    await insertStep(client, a, id, 'trigger', { nodeType: 'trigger.manual' });
    return id;
  });
  runB = await inContext(pool, ctx(b), async (client) => {
    const id = await insertRun(client, b, workflowB, versionB);
    await insertStep(client, b, id, 'trigger', { nodeType: 'trigger.manual' });
    return id;
  });
});

afterAll(async () => {
  await pool.end();
  await migrator.end();
});

describe('catalog of the run tables', () => {
  it.each(TABLES)('%s has row-level security enabled and forced', async (table) => {
    const { rows } = await migrator.query<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>('SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1', [table]);
    expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it.each(TABLES)('grants app_runtime SELECT, INSERT and UPDATE on %s only', async (table) => {
    const { rows } = await migrator.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'app_runtime' AND table_name = $1 ORDER BY privilege_type`,
      [table],
    );
    expect(rows.map((row) => row.privilege_type)).toEqual(['INSERT', 'SELECT', 'UPDATE']);
  });

  it.each(TABLES)('%s has one policy per command for app_runtime', async (table) => {
    const { rows } = await migrator.query<{ roles: string; cmd: string }>(
      `SELECT roles::text, cmd FROM pg_policies WHERE tablename = $1 ORDER BY cmd`,
      [table],
    );
    expect(rows).toEqual([
      { roles: '{app_runtime}', cmd: 'INSERT' },
      { roles: '{app_runtime}', cmd: 'SELECT' },
      { roles: '{app_runtime}', cmd: 'UPDATE' },
    ]);
  });

  it('declares the enums of the data model', async () => {
    const { rows } = await migrator.query<{ typname: string; labels: string[] }>(
      `SELECT t.typname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
         FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname IN ('run_status', 'step_status') GROUP BY t.typname ORDER BY t.typname`,
    );
    expect(rows).toEqual([
      {
        typname: 'run_status',
        labels: ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out'],
      },
      {
        typname: 'step_status',
        labels: ['pending', 'running', 'succeeded', 'failed', 'skipped', 'cancelled'],
      },
    ]);
  });

  it('has the partial index for the concurrency limit and the unique step index', async () => {
    const { rows } = await migrator.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename IN ('workflow_runs', 'workflow_run_steps')`,
    );
    const defs = rows.map((row) => row.indexdef).join('\n');
    expect(defs).toMatch(/UNIQUE INDEX .*\(run_id, node_id\)/);
    expect(defs).toMatch(/\(organization_id\) WHERE .*queued.*running/);
    expect(defs).toMatch(/\(workflow_id, created_at DESC/);
  });
});

describe('isolation between organizations', () => {
  it('a query without context sees no rows', async () => {
    await inContext(pool, {}, async (client) => {
      for (const table of TABLES) expect(await count(client, table), table).toBe(0);
    });
  });

  it('organization A sees only its own runs and steps', async () => {
    await inContext(pool, ctx(a), async (client) => {
      expect(await count(client, 'workflow_runs', `id = '${runA}'`)).toBe(1);
      expect(await count(client, 'workflow_runs', `id = '${runB}'`)).toBe(0);
      expect(await count(client, 'workflow_run_steps', `run_id = '${runA}'`)).toBe(1);
      expect(await count(client, 'workflow_run_steps', `run_id = '${runB}'`)).toBe(0);
    });
  });

  it('cannot update a run or a step of another organization', async () => {
    await inContext(pool, ctx(a), async (client) => {
      const run = await client.query(`UPDATE workflow_runs SET status = 'running' WHERE id = $1`, [
        runB,
      ]);
      expect(run.rowCount).toBe(0);
      const step = await client.query(
        `UPDATE workflow_run_steps SET status = 'running' WHERE run_id = $1`,
        [runB],
      );
      expect(step.rowCount).toBe(0);
    });
    await inContext(pool, ctx(b), async (client) => {
      expect(await count(client, 'workflow_runs', `id = '${runB}' AND status = 'queued'`)).toBe(1);
      expect(
        await count(client, 'workflow_run_steps', `run_id = '${runB}' AND status = 'pending'`),
      ).toBe(1);
    });
  });

  it('cannot insert a run or a step for another organization (the trigger fails closed)', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () =>
          insertRun(client, a, workflowB, versionB, {
            organizationId: b.organizationId,
          }),
        CHECK_VIOLATION,
      );
      await failing(
        client,
        () => insertStep(client, a, runB, 'other', { organizationId: b.organizationId }),
        CHECK_VIOLATION,
      );
    });
  });

  it('cannot move a run to another organization (the trigger fails closed)', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () =>
          client.query('UPDATE workflow_runs SET organization_id = $2 WHERE id = $1', [
            runA,
            b.organizationId,
          ]),
        CHECK_VIOLATION,
      );
    });
  });
});

describe('same-organization triggers', () => {
  it('rejects a run that points at a workflow of another organization', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(client, () => insertRun(client, a, workflowB, versionB), CHECK_VIOLATION);
    });
  });

  it('rejects a run whose organization differs from its workflow organization', async () => {
    await inContext(pool, ctx(b), async (client) => {
      await failing(client, () => insertRun(client, b, workflowA, versionA), CHECK_VIOLATION);
    });
  });

  it('rejects a step whose organization differs from its run', async () => {
    // Organization B is the context, but the step claims B and points at a run of A.
    await inContext(pool, ctx(b), async (client) => {
      await failing(client, () => insertStep(client, b, runA, 'cross'), CHECK_VIOLATION);
    });
  });

  it('accepts a step of the same organization', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await insertStep(client, a, runA, 'second');
      expect(await count(client, 'workflow_run_steps', `run_id = '${runA}'`)).toBeGreaterThan(1);
    });
  });
});

describe('constraints', () => {
  it('rejects a version that belongs to another workflow (composite foreign key)', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () => insertRun(client, a, workflowA, versionA2),
        FOREIGN_KEY_VIOLATION,
      );
    });
  });

  it('rejects a repeated temporal_workflow_id', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () => insertRun(client, a, workflowA, versionA, { temporalWorkflowId: `run-${runA}` }),
        UNIQUE_VIOLATION,
      );
    });
  });

  it('rejects a second step for the same node of a run', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () => insertStep(client, a, runA, 'trigger', { nodeType: 'trigger.manual' }),
        UNIQUE_VIOLATION,
      );
    });
  });

  it.each([
    ['version_number below 1', { versionNumber: 0 }],
    ['error_message over 500 characters', { errorMessage: 'x'.repeat(501) }],
    ['a terminal run without finished_at', { status: 'failed' }],
    ['a queued run with finished_at', { finishedAt: '2026-01-01T00:00:00Z' }],
    ['cancelled_by on a run that is not cancelled', { status: 'running', cancelledBy: 'self' }],
  ])('rejects %s', async (_name, overrides) => {
    await inContext(pool, ctx(a), async (client) => {
      const resolved: RunOverrides = {
        ...overrides,
        ...('cancelledBy' in overrides ? { cancelledBy: a.userId } : {}),
      };
      await failing(
        client,
        () => insertRun(client, a, workflowA, versionA, resolved),
        CHECK_VIOLATION,
      );
    });
  });

  it('accepts a terminal run with finished_at and a cancelled run with cancelled_by', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await insertRun(client, a, workflowA, versionA, {
        status: 'cancelled',
        finishedAt: '2026-01-01T00:00:00Z',
        cancelledBy: a.userId,
      });
      await insertRun(client, a, workflowA, versionA, { rerunOf: runA });
    });
  });

  it('rejects a rerun_of that points at nothing', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () => insertRun(client, a, workflowA, versionA, { rerunOf: randomUUID() }),
        FOREIGN_KEY_VIOLATION,
      );
    });
  });

  it.each<
    [string, { node: string; nodeType?: string; attempts?: number; durationMs?: number }, string]
  >([
    ['node_id with uppercase', { node: 'Node' }, CHECK_VIOLATION],
    ['node_id starting with a digit', { node: '1node' }, CHECK_VIOLATION],
    ['node_id over 40 characters', { node: `n${'a'.repeat(40)}` }, CHECK_VIOLATION],
    ['node_type over 40 characters', { node: 'ok', nodeType: 'x'.repeat(41) }, CHECK_VIOLATION],
    ['negative attempts', { node: 'ok', attempts: -1 }, CHECK_VIOLATION],
    ['negative duration_ms', { node: 'ok', durationMs: -5 }, CHECK_VIOLATION],
  ])('rejects a step with %s', async (_name, step, code) => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(client, () => insertStep(client, a, runA, step.node, step), code);
    });
  });
});

describe('immutable terminal runs', () => {
  async function terminalRun(client: pg.PoolClient, status: string): Promise<string> {
    return insertRun(client, a, workflowA, versionA, {
      status,
      finishedAt: '2026-01-01T00:00:00Z',
      ...(status === 'cancelled' ? { cancelledBy: a.userId } : {}),
    });
  }

  it.each(['succeeded', 'failed', 'cancelled', 'timed_out'])(
    'a %s run cannot go back to another status',
    async (status) => {
      await inContext(pool, ctx(a), async (client) => {
        const id = await terminalRun(client, status);
        await failing(
          client,
          () => client.query(`UPDATE workflow_runs SET status = 'running' WHERE id = $1`, [id]),
          CHECK_VIOLATION,
        );
        const other = status === 'failed' ? 'succeeded' : 'failed';
        await failing(
          client,
          () => client.query(`UPDATE workflow_runs SET status = $2 WHERE id = $1`, [id, other]),
          CHECK_VIOLATION,
        );
      });
    },
  );

  it('a running run can finish, and updated_at moves forward', async () => {
    await inContext(pool, ctx(a), async (client) => {
      const id = await insertRun(client, a, workflowA, versionA, { status: 'running' });
      const before = await client.query<{ updated_at: Date }>(
        'SELECT updated_at FROM workflow_runs WHERE id = $1',
        [id],
      );
      await client.query('SELECT pg_sleep(0.01)');
      await client.query(
        `UPDATE workflow_runs SET status = 'succeeded', finished_at = now() WHERE id = $1`,
        [id],
      );
      const after = await client.query<{ updated_at: Date; status: string }>(
        'SELECT updated_at, status FROM workflow_runs WHERE id = $1',
        [id],
      );
      expect(after.rows[0]!.status).toBe('succeeded');
      expect(after.rows[0]!.updated_at.getTime()).toBeGreaterThanOrEqual(
        before.rows[0]!.updated_at.getTime(),
      );
    });
  });
});

describe('no DELETE and no TRUNCATE', () => {
  it.each(TABLES)('app_runtime cannot delete from %s', async (table) => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(client, () => client.query(`DELETE FROM ${table}`), INSUFFICIENT_PRIVILEGE);
    });
  });

  it.each(TABLES)('app_runtime cannot truncate %s', async (table) => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(client, () => client.query(`TRUNCATE ${table}`), INSUFFICIENT_PRIVILEGE);
    });
  });
});

describe('organization_limits.max_concurrent_runs', () => {
  async function operatorInsert(organizationId: string, maxRuns?: number): Promise<void> {
    const client = await migrator.connect();
    try {
      await client.query('BEGIN');
      const columns = maxRuns === undefined ? '' : ', max_concurrent_runs';
      const values = maxRuns === undefined ? '' : ', $2';
      await client.query(
        `INSERT INTO organization_limits
           (organization_id, max_nodes, max_edges, max_definition_bytes, updated_by${columns})
         VALUES ($1, 10, 10, 2048, 'rls-runs-test'${values})`,
        maxRuns === undefined ? [organizationId] : [organizationId, maxRuns],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  it('defaults to 5 and is readable by app_runtime in its own organization', async () => {
    const tenant = await createTenant(pool, 'limit-default');
    await operatorInsert(tenant.organizationId);
    await inContext(pool, ctx(tenant), async (client) => {
      const { rows } = await client.query<{ max_concurrent_runs: number }>(
        'SELECT max_concurrent_runs FROM organization_limits',
      );
      expect(rows).toEqual([{ max_concurrent_runs: 5 }]);
    });
  });

  it('accepts the bounds 1 and 100 and rejects values outside 1 to 100', async () => {
    const low = await createTenant(pool, 'limit-low');
    const high = await createTenant(pool, 'limit-high');
    await operatorInsert(low.organizationId, 1);
    await operatorInsert(high.organizationId, 100);
    for (const value of [0, 101, -1]) {
      const tenant = await createTenant(pool, 'limit-bad');
      await expectSqlError(operatorInsert(tenant.organizationId, value), CHECK_VIOLATION);
    }
  });

  it('app_runtime still cannot write the limits', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () => client.query('UPDATE organization_limits SET max_concurrent_runs = 100'),
        INSUFFICIENT_PRIVILEGE,
      );
    });
  });
});
