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

// Data model of F4 (specs/005-resilience/data-model.md): node_effects and the columns that
// reused, error_class, waiting_reason and rerun_from_node_id add to the run tables.

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

const EMPTY = '{"schemaVersion":1,"nodes":[],"edges":[]}';

let pool: pg.Pool;
let migrator: pg.Pool;
let a: Tenant;
let b: Tenant;
let runA: string;
let runA2: string;
let runB: string;
let finishedRunA: string;

const ctx = (tenant: Tenant) => ({
  userId: tenant.userId,
  organizationId: tenant.organizationId,
});

async function createRun(
  tenant: Tenant,
  workflowId: string,
  versionId: string,
  extra: { status?: string; rerunOf?: string; rerunFromNodeId?: string; errorClass?: string } = {},
): Promise<string> {
  const id = randomUUID();
  const finished = ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(extra.status ?? '');
  await inContext(pool, ctx(tenant), async (client) => {
    await client.query(
      `INSERT INTO workflow_runs
         (id, organization_id, workflow_id, version_id, version_number, status, triggered_by,
          correlation_id, temporal_workflow_id, finished_at, rerun_of, rerun_from_node_id,
          error_class)
       VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        tenant.organizationId,
        workflowId,
        versionId,
        extra.status ?? 'running',
        tenant.userId,
        randomUUID(),
        `run-${id}`,
        finished ? new Date().toISOString() : null,
        extra.rerunOf ?? null,
        extra.rerunFromNodeId ?? null,
        extra.errorClass ?? null,
      ],
    );
  });
  return id;
}

async function createWorkflowVersion(
  tenant: Tenant,
): Promise<{ workflow: string; version: string }> {
  return inContext(pool, ctx(tenant), async (client) => {
    const workflow = await client.query<{ id: string }>(
      `INSERT INTO workflows (organization_id, name, draft_updated_by, created_by)
       VALUES ($1, $2, $3, $3) RETURNING id`,
      [tenant.organizationId, `Flujo ${randomUUID().slice(0, 6)}`, tenant.userId],
    );
    const workflowId = workflow.rows[0]!.id;
    await client.query(
      'INSERT INTO workflow_active_versions (workflow_id, organization_id) VALUES ($1, $2)',
      [workflowId, tenant.organizationId],
    );
    const version = await client.query<{ id: string }>(
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
    return { workflow: workflowId, version: version.rows[0]!.id };
  });
}

interface EffectOverrides {
  organizationId?: string;
  key?: string;
  status?: string;
  attempts?: number;
  committedAt?: string | null;
}

async function insertEffect(
  client: pg.PoolClient,
  tenant: Tenant,
  runId: string,
  nodeId: string,
  overrides: EffectOverrides = {},
): Promise<void> {
  await client.query(
    `INSERT INTO node_effects
       (organization_id, run_id, node_id, idempotency_key, status, attempts, committed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      overrides.organizationId ?? tenant.organizationId,
      runId,
      nodeId,
      overrides.key ?? `${runId}:${nodeId}`,
      overrides.status ?? 'started',
      overrides.attempts ?? 1,
      overrides.committedAt ?? null,
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
  a = await createTenant(pool, 'effect-a');
  b = await createTenant(pool, 'effect-b');
  const wfA = await createWorkflowVersion(a);
  const wfB = await createWorkflowVersion(b);
  runA = await createRun(a, wfA.workflow, wfA.version);
  runA2 = await createRun(a, wfA.workflow, wfA.version);
  runB = await createRun(b, wfB.workflow, wfB.version);
  finishedRunA = await createRun(a, wfA.workflow, wfA.version, { status: 'failed' });
});

afterAll(async () => {
  await pool.end();
  await migrator.end();
});

describe('catalog of node_effects', () => {
  it('has row-level security enabled and forced', async () => {
    const { rows } = await migrator.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'node_effects'`,
    );
    expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('grants app_runtime SELECT, INSERT and UPDATE only (no DELETE)', async () => {
    const { rows } = await migrator.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'app_runtime' AND table_name = 'node_effects' ORDER BY privilege_type`,
    );
    expect(rows.map((row) => row.privilege_type)).toEqual(['INSERT', 'SELECT', 'UPDATE']);
  });

  it('has one policy per command for app_runtime', async () => {
    const { rows } = await migrator.query(
      `SELECT roles::text, cmd FROM pg_policies WHERE tablename = 'node_effects' ORDER BY cmd`,
    );
    expect(rows).toEqual([
      { roles: '{app_runtime}', cmd: 'INSERT' },
      { roles: '{app_runtime}', cmd: 'SELECT' },
      { roles: '{app_runtime}', cmd: 'UPDATE' },
    ]);
  });

  it('declares effect_status and the new step_status value', async () => {
    const { rows } = await migrator.query<{ typname: string; labels: string[] }>(
      `SELECT t.typname, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
         FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname IN ('effect_status', 'step_status') GROUP BY t.typname ORDER BY t.typname`,
    );
    expect(rows).toEqual([
      { typname: 'effect_status', labels: ['started', 'committed'] },
      {
        typname: 'step_status',
        labels: ['pending', 'running', 'succeeded', 'failed', 'skipped', 'cancelled', 'reused'],
      },
    ]);
  });

  it('has the indexes of the data model', async () => {
    const { rows } = await migrator.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename IN ('node_effects', 'workflow_runs')`,
    );
    const defs = rows.map((row) => row.indexdef).join('\n');
    expect(defs).toMatch(/UNIQUE INDEX .*node_effects.*\(idempotency_key\)/);
    expect(defs).toMatch(/node_effects.*\(run_id\)/);
    expect(defs).toMatch(/workflow_runs.*\(organization_id, created_at DESC/);
    expect(defs).toMatch(/\(organization_id, created_at DESC[^)]*\) WHERE .*failed/);
  });
});

describe('isolation of node_effects', () => {
  beforeAll(async () => {
    await inContext(pool, ctx(a), (client) => insertEffect(client, a, runA, 'svc_a'));
    await inContext(pool, ctx(b), (client) => insertEffect(client, b, runB, 'svc_b'));
  });

  it('a query without context sees no rows', async () => {
    await inContext(pool, {}, async (client) => {
      expect(await count(client, 'node_effects')).toBe(0);
    });
  });

  it('organization A sees only its own effects', async () => {
    await inContext(pool, ctx(a), async (client) => {
      expect(await count(client, 'node_effects', `run_id = '${runA}'`)).toBe(1);
      expect(await count(client, 'node_effects', `run_id = '${runB}'`)).toBe(0);
    });
  });

  it('cannot update an effect of another organization', async () => {
    await inContext(pool, ctx(a), async (client) => {
      const result = await client.query(`UPDATE node_effects SET attempts = 5 WHERE run_id = $1`, [
        runB,
      ]);
      expect(result.rowCount).toBe(0);
    });
  });

  it('cannot insert an effect for another organization (the trigger fails closed)', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () => insertEffect(client, a, runB, 'intruder', { organizationId: b.organizationId }),
        CHECK_VIOLATION,
      );
    });
  });

  it('rejects an effect whose organization differs from the run (the trigger fails closed)', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(client, () => insertEffect(client, a, runB, 'other'), CHECK_VIOLATION);
    });
  });

  it('cannot delete effects, even of its own organization', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () => client.query('DELETE FROM node_effects WHERE run_id = $1', [runA]),
        INSUFFICIENT_PRIVILEGE,
      );
      await failing(client, () => client.query('TRUNCATE node_effects'), INSUFFICIENT_PRIVILEGE);
    });
  });
});

describe('integrity of node_effects', () => {
  it('requires the key to be run_id:node_id', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () => insertEffect(client, a, runA2, 'svc_k', { key: `${runA2}:another` }),
        CHECK_VIOLATION,
      );
      await failing(
        client,
        () => insertEffect(client, a, runA2, 'svc_k', { key: 'free-form' }),
        CHECK_VIOLATION,
      );
    });
  });

  it('allows one effect per key', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await insertEffect(client, a, runA2, 'svc_u');
      await failing(client, () => insertEffect(client, a, runA2, 'svc_u'), UNIQUE_VIOLATION);
    });
  });

  it('accepts ON CONFLICT DO NOTHING on the key (the idempotent start)', async () => {
    await inContext(pool, ctx(a), async (client) => {
      const insert = () =>
        client.query(
          `INSERT INTO node_effects (organization_id, run_id, node_id, idempotency_key)
           VALUES ($1, $2, 'svc_n', $3) ON CONFLICT (idempotency_key) DO NOTHING`,
          [a.organizationId, runA2, `${runA2}:svc_n`],
        );
      expect((await insert()).rowCount).toBe(1);
      expect((await insert()).rowCount).toBe(0);
    });
  });

  it('requires a valid node id', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(client, () => insertEffect(client, a, runA2, 'Bad-Id'), CHECK_VIOLATION);
    });
  });

  it('requires at least one attempt', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () => insertEffect(client, a, runA2, 'svc_z', { attempts: 0 }),
        CHECK_VIOLATION,
      );
    });
  });

  it('requires committed_at exactly when the effect is committed', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () => insertEffect(client, a, runA2, 'svc_c1', { status: 'committed' }),
        CHECK_VIOLATION,
      );
      await failing(
        client,
        () =>
          insertEffect(client, a, runA2, 'svc_c2', {
            status: 'started',
            committedAt: new Date().toISOString(),
          }),
        CHECK_VIOLATION,
      );
      await insertEffect(client, a, runA2, 'svc_c3', {
        status: 'committed',
        committedAt: new Date().toISOString(),
      });
    });
  });

  it('never moves a committed effect back to started', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await insertEffect(client, a, runA2, 'svc_m', {
        status: 'committed',
        committedAt: new Date().toISOString(),
      });
      await failing(
        client,
        () =>
          client.query(
            `UPDATE node_effects SET status = 'started', committed_at = NULL WHERE idempotency_key = $1`,
            [`${runA2}:svc_m`],
          ),
        CHECK_VIOLATION,
      );
    });
  });

  it('commits a started effect and refreshes updated_at', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await insertEffect(client, a, runA2, 'svc_s');
      const before = await client.query<{ updated_at: Date }>(
        'SELECT updated_at FROM node_effects WHERE idempotency_key = $1',
        [`${runA2}:svc_s`],
      );
      await client.query('SELECT pg_sleep(0.02)');
      const result = await client.query(
        `UPDATE node_effects SET status = 'committed', committed_at = now(), attempts = 2
          WHERE idempotency_key = $1`,
        [`${runA2}:svc_s`],
      );
      expect(result.rowCount).toBe(1);
      const after = await client.query<{ updated_at: Date; attempts: number }>(
        'SELECT updated_at, attempts FROM node_effects WHERE idempotency_key = $1',
        [`${runA2}:svc_s`],
      );
      // now() is the transaction start: the trigger must still have advanced the column.
      expect(after.rows[0]!.updated_at.getTime()).toBeGreaterThanOrEqual(
        before.rows[0]!.updated_at.getTime(),
      );
      expect(after.rows[0]!.attempts).toBe(2);
    });
  });
});

describe('columns added to the run tables', () => {
  async function insertStepRow(
    client: pg.PoolClient,
    runId: string,
    nodeId: string,
    columns: Record<string, string | null>,
  ): Promise<void> {
    const names = ['organization_id', 'run_id', 'node_id', 'node_type', ...Object.keys(columns)];
    const values = [a.organizationId, runId, nodeId, 'mock.service', ...Object.values(columns)];
    const placeholders = values.map((_, i) => `$${i + 1}`);
    await client.query(
      `INSERT INTO workflow_run_steps (${names.join(', ')}) VALUES (${placeholders.join(', ')})`,
      values,
    );
  }

  it('accepts reused as a step status', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await insertStepRow(client, runA2, 'step_reused', { status: 'reused' });
      expect(await count(client, 'workflow_run_steps', `status = 'reused'`)).toBeGreaterThan(0);
    });
  });

  it.each(['transient', 'rate_limited', 'timeout', 'permanent'])(
    'accepts the error class %s on a failed step',
    async (errorClass) => {
      await inContext(pool, ctx(a), async (client) => {
        await insertStepRow(client, runA2, `step_${errorClass}`, {
          status: 'failed',
          error_class: errorClass,
        });
      });
    },
  );

  it('rejects an unknown error class', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () => insertStepRow(client, runA2, 'step_bad', { status: 'failed', error_class: 'oops' }),
        CHECK_VIOLATION,
      );
    });
  });

  it('allows the step error class only on a failed step', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () =>
          insertStepRow(client, runA2, 'step_ok', {
            status: 'succeeded',
            error_class: 'permanent',
          }),
        CHECK_VIOLATION,
      );
    });
  });

  it('allows waiting_reason only on a running step, and only rate_limited', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await insertStepRow(client, runA2, 'step_wait', {
        status: 'running',
        waiting_reason: 'rate_limited',
      });
      await failing(
        client,
        () =>
          insertStepRow(client, runA2, 'step_wait2', {
            status: 'pending',
            waiting_reason: 'rate_limited',
          }),
        CHECK_VIOLATION,
      );
      await failing(
        client,
        () =>
          insertStepRow(client, runA2, 'step_wait3', {
            status: 'running',
            waiting_reason: 'sleeping',
          }),
        CHECK_VIOLATION,
      );
    });
  });

  it('allows the run error class only on failed or timed out runs', async () => {
    const wf = await createWorkflowVersion(a);
    await createRun(a, wf.workflow, wf.version, { status: 'failed', errorClass: 'permanent' });
    await createRun(a, wf.workflow, wf.version, { status: 'timed_out', errorClass: 'timeout' });
    await expect(
      createRun(a, wf.workflow, wf.version, { status: 'running', errorClass: 'permanent' }),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    await expect(
      createRun(a, wf.workflow, wf.version, { status: 'failed', errorClass: 'oops' }),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });

  it('allows rerun_from_node_id only on a rerun and with a valid node id', async () => {
    const wf = await createWorkflowVersion(a);
    await createRun(a, wf.workflow, wf.version, {
      rerunOf: finishedRunA,
      rerunFromNodeId: 'svc_a',
    });
    await expect(
      createRun(a, wf.workflow, wf.version, { rerunFromNodeId: 'svc_a' }),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    await expect(
      createRun(a, wf.workflow, wf.version, { rerunOf: finishedRunA, rerunFromNodeId: 'Bad-Id' }),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
  });
});
