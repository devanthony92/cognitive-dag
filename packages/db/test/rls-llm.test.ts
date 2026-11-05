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

// Data model of F5 (specs/006-cognitive-nodes/data-model.md): llm_calls, llm_usage_daily, the
// llm_tokens_used column and the wider error_class CHECK.

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';

const EMPTY = '{"schemaVersion":1,"nodes":[],"edges":[]}';

let pool: pg.Pool;
let migrator: pg.Pool;
let a: Tenant;
let b: Tenant;
let runA: string;
let runB: string;
let finishedRunA: string;

const ctx = (tenant: Tenant) => ({
  userId: tenant.userId,
  organizationId: tenant.organizationId,
});

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

async function createRun(
  tenant: Tenant,
  workflowId: string,
  versionId: string,
  extra: { status?: string; llmTokensUsed?: number; errorClass?: string } = {},
): Promise<string> {
  const id = randomUUID();
  const finished = ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(extra.status ?? '');
  await inContext(pool, ctx(tenant), async (client) => {
    await client.query(
      `INSERT INTO workflow_runs
         (id, organization_id, workflow_id, version_id, version_number, status, triggered_by,
          correlation_id, temporal_workflow_id, finished_at, llm_tokens_used, error_class)
       VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9, $10, $11)`,
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
        extra.llmTokensUsed ?? 0,
        extra.errorClass ?? null,
      ],
    );
  });
  return id;
}

interface CallOverrides {
  organizationId?: string;
  nodeId?: string;
  nodeType?: string;
  attempt?: number;
  repairs?: number;
  model?: string;
  reservedTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  costMicroUsd?: number;
  outcome?: string;
  errorCode?: string | null;
  durationMs?: number;
}

async function insertCall(
  client: pg.PoolClient,
  tenant: Tenant,
  runId: string,
  overrides: CallOverrides = {},
): Promise<string> {
  const outcome = overrides.outcome ?? 'succeeded';
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO llm_calls
       (organization_id, run_id, node_id, node_type, attempt, repairs, model, reserved_tokens,
        input_tokens, output_tokens, cost_micro_usd, outcome, error_code, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
    [
      overrides.organizationId ?? tenant.organizationId,
      runId,
      overrides.nodeId ?? 'ask',
      overrides.nodeType ?? 'llm.generate',
      overrides.attempt ?? 1,
      overrides.repairs ?? 0,
      overrides.model ?? 'fake-model',
      overrides.reservedTokens ?? 300,
      overrides.inputTokens ?? 100,
      overrides.outputTokens ?? 50,
      overrides.costMicroUsd ?? 25,
      outcome,
      overrides.errorCode === undefined
        ? outcome === 'succeeded'
          ? null
          : 'LLM_INVALID_OUTPUT'
        : overrides.errorCode,
      overrides.durationMs ?? 120,
    ],
  );
  return rows[0]!.id;
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
  a = await createTenant(pool, 'llm-a');
  b = await createTenant(pool, 'llm-b');
  const wfA = await createWorkflowVersion(a);
  const wfB = await createWorkflowVersion(b);
  runA = await createRun(a, wfA.workflow, wfA.version);
  runB = await createRun(b, wfB.workflow, wfB.version);
  finishedRunA = await createRun(a, wfA.workflow, wfA.version, {
    status: 'failed',
    llmTokensUsed: 1000,
  });
});

afterAll(async () => {
  await pool.end();
  await migrator.end();
});

describe('catalog of llm_calls and llm_usage_daily', () => {
  it.each(['llm_calls', 'llm_usage_daily'])(
    'has row-level security enabled and forced on %s',
    async (table) => {
      const { rows } = await migrator.query(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1`,
        [table],
      );
      expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    },
  );

  it('grants app_runtime SELECT and INSERT on llm_calls (no UPDATE, no DELETE)', async () => {
    const { rows } = await migrator.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'app_runtime' AND table_name = 'llm_calls' ORDER BY privilege_type`,
    );
    expect(rows.map((row) => row.privilege_type)).toEqual(['INSERT', 'SELECT']);
  });

  it('grants app_runtime SELECT, INSERT and UPDATE on llm_usage_daily (no DELETE)', async () => {
    const { rows } = await migrator.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'app_runtime' AND table_name = 'llm_usage_daily'
        ORDER BY privilege_type`,
    );
    expect(rows.map((row) => row.privilege_type)).toEqual(['INSERT', 'SELECT', 'UPDATE']);
  });

  it('has the indexes of the data model', async () => {
    const { rows } = await migrator.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename IN ('llm_calls', 'llm_usage_daily')`,
    );
    const defs = rows.map((row) => row.indexdef).join('\n');
    expect(defs).toMatch(/llm_calls.*\(run_id, node_id\)/);
    expect(defs).toMatch(/llm_calls.*\(organization_id, created_at DESC/);
    expect(defs).toMatch(/UNIQUE INDEX .*llm_usage_daily.*\(organization_id, usage_date\)/);
  });
});

describe('isolation of llm_calls', () => {
  beforeAll(async () => {
    await inContext(pool, ctx(a), (client) => insertCall(client, a, runA, { nodeId: 'only_a' }));
    await inContext(pool, ctx(b), (client) => insertCall(client, b, runB, { nodeId: 'only_b' }));
  });

  it('a query without context sees no rows', async () => {
    await inContext(pool, {}, async (client) => {
      expect(await count(client, 'llm_calls')).toBe(0);
    });
  });

  it('organization A sees only its own calls', async () => {
    await inContext(pool, ctx(a), async (client) => {
      expect(await count(client, 'llm_calls', `run_id = '${runA}'`)).toBe(1);
      expect(await count(client, 'llm_calls', `run_id = '${runB}'`)).toBe(0);
    });
  });

  it('cannot insert a call for another organization (the trigger fails closed)', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () => insertCall(client, a, runB, { organizationId: b.organizationId }),
        CHECK_VIOLATION,
      );
      await failing(client, () => insertCall(client, a, runB), CHECK_VIOLATION);
    });
  });

  it('rejects a call whose organization differs from the run', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () => insertCall(client, a, runA, { organizationId: b.organizationId }),
        CHECK_VIOLATION,
      );
    });
  });

  it('cannot delete calls, even of its own organization', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () => client.query('DELETE FROM llm_calls WHERE run_id = $1', [runA]),
        INSUFFICIENT_PRIVILEGE,
      );
      await failing(client, () => client.query('TRUNCATE llm_calls'), INSUFFICIENT_PRIVILEGE);
    });
  });

  it('cannot update calls: the table is immutable', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () => client.query('UPDATE llm_calls SET output_tokens = 1 WHERE run_id = $1', [runA]),
        INSUFFICIENT_PRIVILEGE,
      );
    });
  });
});

describe('integrity of llm_calls', () => {
  it('stores a succeeded call and a failed one with its error code', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await insertCall(client, a, runA, { nodeId: 'ok_node' });
      await insertCall(client, a, runA, {
        nodeId: 'bad_node',
        outcome: 'invalid_output',
        errorCode: 'LLM_INVALID_OUTPUT',
        repairs: 2,
      });
      await insertCall(client, a, runA, {
        nodeId: 'failed_node',
        outcome: 'failed',
        errorCode: 'LLM_PROVIDER_UNAVAILABLE',
      });
    });
  });

  it.each(['llm.classify', 'llm.extract', 'llm.generate'])(
    'accepts the node type %s',
    async (type) => {
      await inContext(pool, ctx(a), (client) =>
        insertCall(client, a, runA, { nodeId: 'typed', nodeType: type }),
      );
    },
  );

  it.each([
    ['an unknown node type', { nodeType: 'http.request' }],
    ['an unknown outcome', { outcome: 'weird', errorCode: 'X' }],
    ['a failure without error code', { outcome: 'failed', errorCode: null }],
    ['a success with an error code', { outcome: 'succeeded', errorCode: 'LLM_X' }],
    ['an error code over 64 characters', { outcome: 'failed', errorCode: 'X'.repeat(65) }],
    ['three repairs', { repairs: 3 }],
    ['negative repairs', { repairs: -1 }],
    ['attempt zero', { attempt: 0 }],
    ['a node id with a bad format', { nodeId: 'Bad Id' }],
    ['an empty model', { model: '' }],
    ['a model over 64 characters', { model: 'm'.repeat(65) }],
    ['negative reserved tokens', { reservedTokens: -1 }],
    ['negative input tokens', { inputTokens: -1 }],
    ['negative output tokens', { outputTokens: -1 }],
    ['negative cost', { costMicroUsd: -1 }],
    ['negative duration', { durationMs: -1 }],
  ] as [string, CallOverrides][])('rejects %s', async (_name, overrides) => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(client, () => insertCall(client, a, runA, overrides), CHECK_VIOLATION);
    });
  });
});

describe('llm_usage_daily', () => {
  const day = '2026-11-05';

  it('is isolated by organization', async () => {
    await inContext(pool, ctx(a), (client) =>
      client.query(
        'INSERT INTO llm_usage_daily (organization_id, usage_date, tokens_used) VALUES ($1, $2, 10)',
        [a.organizationId, day],
      ),
    );
    await inContext(pool, ctx(b), async (client) => {
      expect(await count(client, 'llm_usage_daily')).toBe(0);
      await failing(
        client,
        () =>
          client.query(
            'INSERT INTO llm_usage_daily (organization_id, usage_date, tokens_used) VALUES ($1, $2, 1)',
            [a.organizationId, day],
          ),
        '42501',
      );
    });
    await inContext(pool, {}, async (client) => {
      expect(await count(client, 'llm_usage_daily')).toBe(0);
    });
  });

  it('keeps one row per organization and day (the atomic reservation upsert)', async () => {
    await inContext(pool, ctx(a), async (client) => {
      const limit = 100;
      const reserve = (amount: number) =>
        client.query(
          `INSERT INTO llm_usage_daily (organization_id, usage_date, tokens_used)
           VALUES ($1, $2, $3)
           ON CONFLICT (organization_id, usage_date) DO UPDATE
             SET tokens_used = llm_usage_daily.tokens_used + $3
           WHERE llm_usage_daily.tokens_used + $3 <= $4
           RETURNING tokens_used`,
          [a.organizationId, day, amount, limit],
        );
      expect((await reserve(50)).rowCount).toBe(1); // 10 + 50
      expect((await reserve(40)).rowCount).toBe(1); // 100
      expect((await reserve(1)).rowCount).toBe(0); // over the limit: no row
      expect(
        await count(client, 'llm_usage_daily', `organization_id = '${a.organizationId}'`),
      ).toBe(1);
    });
  });

  it('refreshes updated_at on update', async () => {
    await inContext(pool, ctx(a), async (client) => {
      const before = await client.query<{ updated_at: Date }>(
        'SELECT updated_at FROM llm_usage_daily WHERE organization_id = $1 AND usage_date = $2',
        [a.organizationId, day],
      );
      await client.query('SELECT pg_sleep(0.01)');
      await client.query(
        'UPDATE llm_usage_daily SET cost_micro_usd = cost_micro_usd + 5 WHERE organization_id = $1 AND usage_date = $2',
        [a.organizationId, day],
      );
      const after = await client.query<{ updated_at: Date }>(
        'SELECT updated_at FROM llm_usage_daily WHERE organization_id = $1 AND usage_date = $2',
        [a.organizationId, day],
      );
      expect(after.rows[0]!.updated_at.getTime()).toBeGreaterThanOrEqual(
        before.rows[0]!.updated_at.getTime(),
      );
    });
  });

  it('cannot delete rows', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () => client.query('DELETE FROM llm_usage_daily'),
        INSUFFICIENT_PRIVILEGE,
      );
      await failing(client, () => client.query('TRUNCATE llm_usage_daily'), INSUFFICIENT_PRIVILEGE);
    });
  });

  it.each([
    ['negative tokens', 'tokens_used', -1],
    ['negative cost', 'cost_micro_usd', -1],
  ])('rejects %s', async (_name, column, value) => {
    await inContext(pool, ctx(b), async (client) => {
      await failing(
        client,
        () =>
          client.query(
            `INSERT INTO llm_usage_daily (organization_id, usage_date, ${column}) VALUES ($1, '2026-11-06', $2)`,
            [b.organizationId, value],
          ),
        CHECK_VIOLATION,
      );
    });
  });
});

describe('workflow_runs.llm_tokens_used', () => {
  it('defaults to zero and cannot be negative', async () => {
    await inContext(pool, ctx(a), async (client) => {
      const { rows } = await client.query<{ llm_tokens_used: number }>(
        'SELECT llm_tokens_used FROM workflow_runs WHERE id = $1',
        [runA],
      );
      expect(rows[0]!.llm_tokens_used).toBe(0);
      await failing(
        client,
        () => client.query('UPDATE workflow_runs SET llm_tokens_used = -1 WHERE id = $1', [runA]),
        CHECK_VIOLATION,
      );
    });
  });

  it('is reserved and adjusted while the run is in progress, up and down', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await client.query('UPDATE workflow_runs SET llm_tokens_used = 500 WHERE id = $1', [runA]);
      await client.query('UPDATE workflow_runs SET llm_tokens_used = 300 WHERE id = $1', [runA]);
      const { rows } = await client.query<{ llm_tokens_used: number }>(
        'SELECT llm_tokens_used FROM workflow_runs WHERE id = $1',
        [runA],
      );
      expect(rows[0]!.llm_tokens_used).toBe(300);
    });
  });

  it('can only go down once the run is finished (a call in flight settling late)', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await client.query('UPDATE workflow_runs SET llm_tokens_used = 800 WHERE id = $1', [
        finishedRunA,
      ]);
      await failing(
        client,
        () =>
          client.query('UPDATE workflow_runs SET llm_tokens_used = 801 WHERE id = $1', [
            finishedRunA,
          ]),
        CHECK_VIOLATION,
      );
      await client.query('UPDATE workflow_runs SET llm_tokens_used = 800 WHERE id = $1', [
        finishedRunA,
      ]);
    });
  });

  it('still never lets a finished run change its status', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () =>
          client.query("UPDATE workflow_runs SET status = 'running' WHERE id = $1", [finishedRunA]),
        CHECK_VIOLATION,
      );
    });
  });
});

describe('error_class widened to invalid_output and budget_exhausted', () => {
  it.each(['invalid_output', 'budget_exhausted'])(
    'accepts %s on a failed run and on a failed step',
    async (errorClass) => {
      const wf = await createWorkflowVersion(a);
      const run = await createRun(a, wf.workflow, wf.version, { status: 'failed', errorClass });
      await inContext(pool, ctx(a), async (client) => {
        await client.query(
          `INSERT INTO workflow_run_steps (organization_id, run_id, node_id, node_type, status, error_class)
           VALUES ($1, $2, 'ask', 'llm.generate', 'failed', $3)`,
          [a.organizationId, run, errorClass],
        );
      });
    },
  );

  it('still rejects an unknown class on runs and on steps', async () => {
    const wf = await createWorkflowVersion(a);
    await expect(
      createRun(a, wf.workflow, wf.version, { status: 'failed', errorClass: 'oops' }),
    ).rejects.toMatchObject({ code: CHECK_VIOLATION });
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () =>
          client.query(
            `INSERT INTO workflow_run_steps (organization_id, run_id, node_id, node_type, status, error_class)
             VALUES ($1, $2, 'bad', 'llm.generate', 'failed', 'oops')`,
            [a.organizationId, runA],
          ),
        CHECK_VIOLATION,
      );
    });
  });
});
