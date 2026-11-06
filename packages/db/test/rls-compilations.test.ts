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

// Data model of F6 (specs/007-nl-compiler/data-model.md): compilations and the llm_calls table
// generalized to belong to a run or to a compilation.

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';

const EMPTY = '{"schemaVersion":1,"nodes":[],"edges":[]}';

let pool: pg.Pool;
let migrator: pg.Pool;
let a: Tenant;
let b: Tenant;
let workflowA: string;
let workflowB: string;
let runA: string;

const ctx = (tenant: Tenant) => ({
  userId: tenant.userId,
  organizationId: tenant.organizationId,
});

async function createWorkflow(tenant: Tenant): Promise<string> {
  return inContext(pool, ctx(tenant), async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO workflows (organization_id, name, draft_updated_by, created_by)
       VALUES ($1, $2, $3, $3) RETURNING id`,
      [tenant.organizationId, `Flujo ${randomUUID().slice(0, 6)}`, tenant.userId],
    );
    return rows[0]!.id;
  });
}

async function createRun(tenant: Tenant, workflowId: string): Promise<string> {
  const runId = randomUUID();
  await inContext(pool, ctx(tenant), async (client) => {
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
    await client.query(
      `INSERT INTO workflow_runs
         (id, organization_id, workflow_id, version_id, version_number, triggered_by,
          correlation_id, temporal_workflow_id)
       VALUES ($1, $2, $3, $4, 1, $5, $6, $7)`,
      [
        runId,
        tenant.organizationId,
        workflowId,
        version.rows[0]!.id,
        tenant.userId,
        randomUUID(),
        `run-${runId}`,
      ],
    );
  });
  return runId;
}

interface CompilationOverrides {
  organizationId?: string;
  workflowId?: string | null;
  mode?: string;
  baseDraftRevision?: number | null;
  status?: string;
  intentChars?: number;
  model?: string;
  calls?: number;
  repairs?: number;
  llmTokensUsed?: number;
  costMicroUsd?: number;
  nodeCount?: number | null;
  hasFallback?: boolean;
  errorClass?: string | null;
  errorCode?: string | null;
  finishedAt?: string | null;
}

/** A `create` compilation by default; `finished` fills what a final state requires. */
async function insertCompilation(
  client: pg.PoolClient,
  tenant: Tenant,
  overrides: CompilationOverrides = {},
): Promise<string> {
  const status = overrides.status ?? 'queued';
  const final = status === 'succeeded' || status === 'failed';
  const id = randomUUID();
  const mode = overrides.mode ?? 'create';
  await client.query(
    `INSERT INTO compilations
       (id, organization_id, workflow_id, requested_by, mode, base_draft_revision, status,
        intent_chars, model, calls, repairs, llm_tokens_used, cost_micro_usd, node_count,
        has_fallback, error_class, error_code, correlation_id, finished_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
    [
      id,
      overrides.organizationId ?? tenant.organizationId,
      overrides.workflowId === undefined ? null : overrides.workflowId,
      tenant.userId,
      mode,
      overrides.baseDraftRevision === undefined ? null : overrides.baseDraftRevision,
      status,
      overrides.intentChars ?? 120,
      overrides.model ?? 'fake-model',
      overrides.calls ?? 0,
      overrides.repairs ?? 0,
      overrides.llmTokensUsed ?? 0,
      overrides.costMicroUsd ?? 0,
      overrides.nodeCount === undefined ? null : overrides.nodeCount,
      overrides.hasFallback ?? false,
      overrides.errorClass === undefined ? null : overrides.errorClass,
      overrides.errorCode === undefined
        ? status === 'failed'
          ? 'COMPILER_INVALID_DAG'
          : null
        : overrides.errorCode,
      randomUUID(),
      overrides.finishedAt === undefined
        ? final
          ? new Date().toISOString()
          : null
        : overrides.finishedAt,
    ],
  );
  return id;
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

interface CallOverrides {
  organizationId?: string;
  runId?: string | null;
  nodeId?: string | null;
  compilationId?: string | null;
  nodeType?: string;
}

async function insertCall(
  client: pg.PoolClient,
  tenant: Tenant,
  overrides: CallOverrides,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO llm_calls
       (organization_id, run_id, node_id, compilation_id, node_type, attempt, repairs, model,
        reserved_tokens, input_tokens, output_tokens, cost_micro_usd, outcome, error_code,
        duration_ms)
     VALUES ($1, $2, $3, $4, $5, 1, 0, 'fake-model', 300, 100, 50, 25, 'succeeded', NULL, 120)
     RETURNING id`,
    [
      overrides.organizationId ?? tenant.organizationId,
      overrides.runId === undefined ? null : overrides.runId,
      overrides.nodeId === undefined ? null : overrides.nodeId,
      overrides.compilationId === undefined ? null : overrides.compilationId,
      overrides.nodeType ?? 'compiler',
    ],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  pool = runtimePool();
  migrator = migratorPool();
  a = await createTenant(pool, 'comp-a');
  b = await createTenant(pool, 'comp-b');
  workflowA = await createWorkflow(a);
  workflowB = await createWorkflow(b);
  runA = await createRun(a, workflowA);
});

afterAll(async () => {
  await pool.end();
  await migrator.end();
});

describe('catalog of compilations', () => {
  it('has row-level security enabled and forced', async () => {
    const { rows } = await migrator.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'compilations'`,
    );
    expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('grants app_runtime SELECT, INSERT and UPDATE only (no DELETE, no TRUNCATE)', async () => {
    const { rows } = await migrator.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'app_runtime' AND table_name = 'compilations' ORDER BY privilege_type`,
    );
    expect(rows.map((row) => row.privilege_type)).toEqual(['INSERT', 'SELECT', 'UPDATE']);
  });

  it('keeps llm_calls as SELECT and INSERT only', async () => {
    const { rows } = await migrator.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'app_runtime' AND table_name = 'llm_calls' ORDER BY privilege_type`,
    );
    expect(rows.map((row) => row.privilege_type)).toEqual(['INSERT', 'SELECT']);
  });

  it('has the indexes of the data model', async () => {
    const { rows } = await migrator.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename IN ('compilations', 'llm_calls')`,
    );
    const defs = rows.map((row) => row.indexdef).join('\n');
    expect(defs).toMatch(/ON public\.compilations .*\(organization_id, created_at DESC/);
    expect(defs).toMatch(
      /ON public\.compilations .*\(workflow_id, created_at DESC.*WHERE \(workflow_id IS NOT NULL\)/,
    );
    expect(defs).toMatch(
      /ON public\.llm_calls .*\(compilation_id\).*WHERE \(compilation_id IS NOT NULL\)/,
    );
  });
});

describe('isolation of compilations', () => {
  let idA: string;
  let idB: string;

  beforeAll(async () => {
    idA = await inContext(pool, ctx(a), (client) => insertCompilation(client, a));
    idB = await inContext(pool, ctx(b), (client) => insertCompilation(client, b));
  });

  it('a query without context sees no rows', async () => {
    await inContext(pool, {}, async (client) => {
      expect(await count(client, 'compilations')).toBe(0);
    });
  });

  it('organization A sees only its own compilations', async () => {
    await inContext(pool, ctx(a), async (client) => {
      expect(await count(client, 'compilations', `id = '${idA}'`)).toBe(1);
      expect(await count(client, 'compilations', `id = '${idB}'`)).toBe(0);
    });
  });

  it('cannot insert a compilation for another organization', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () => insertCompilation(client, a, { organizationId: b.organizationId }),
        INSUFFICIENT_PRIVILEGE,
      );
    });
  });

  it('cannot update a compilation of another organization (no row is visible)', async () => {
    await inContext(pool, ctx(a), async (client) => {
      const result = await client.query(
        "UPDATE compilations SET status = 'running' WHERE id = $1",
        [idB],
      );
      expect(result.rowCount).toBe(0);
    });
  });

  it('cannot delete compilations, even of its own organization', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () => client.query('DELETE FROM compilations WHERE id = $1', [idA]),
        INSUFFICIENT_PRIVILEGE,
      );
      await failing(client, () => client.query('TRUNCATE compilations'), INSUFFICIENT_PRIVILEGE);
    });
  });
});

describe('integrity of compilations', () => {
  it('accepts a regenerate compilation of a workflow of the same organization', async () => {
    await inContext(pool, ctx(a), (client) =>
      insertCompilation(client, a, {
        mode: 'regenerate',
        workflowId: workflowA,
        baseDraftRevision: 3,
      }),
    );
  });

  it('rejects a workflow of another organization (the trigger fails closed)', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () =>
          insertCompilation(client, a, {
            mode: 'regenerate',
            workflowId: workflowB,
            baseDraftRevision: 1,
          }),
        CHECK_VIOLATION,
      );
    });
  });

  it.each([
    ['an unknown mode', { mode: 'other' }],
    ['create with a workflow', { mode: 'create', workflowId: 'A' }],
    ['create with a base revision', { mode: 'create', baseDraftRevision: 1 }],
    ['regenerate without a workflow', { mode: 'regenerate', baseDraftRevision: 1 }],
    ['regenerate without a base revision', { mode: 'regenerate', workflowId: 'A' }],
    ['a base revision of zero', { mode: 'regenerate', workflowId: 'A', baseDraftRevision: 0 }],
    ['an unknown status', { status: 'weird' }],
    ['an empty intent', { intentChars: 0 }],
    ['an intent over 2000 characters', { intentChars: 2001 }],
    ['an empty model', { model: '' }],
    ['a model over 64 characters', { model: 'm'.repeat(65) }],
    ['four calls', { calls: 4 }],
    ['negative calls', { calls: -1 }],
    ['three repairs', { repairs: 3 }],
    ['negative tokens', { llmTokensUsed: -1 }],
    ['negative cost', { costMicroUsd: -1 }],
    ['a negative node count', { nodeCount: -1 }],
    ['an unknown error class', { status: 'failed', errorClass: 'oops' }],
    ['an error code over 64 characters', { status: 'failed', errorCode: 'X'.repeat(65) }],
    ['a failed compilation without error code', { status: 'failed', errorCode: null }],
    ['a succeeded compilation with an error code', { status: 'succeeded', errorCode: 'X' }],
    ['an error class on a compilation that did not fail', { errorClass: 'transient' }],
    ['a final state without finished_at', { status: 'succeeded', finishedAt: null }],
    ['finished_at on a compilation in progress', { finishedAt: '2026-11-06T00:00:00Z' }],
    ['a fallback on a succeeded compilation', { status: 'succeeded', hasFallback: true }],
    ['a fallback on a queued compilation', { hasFallback: true }],
  ] as [string, CompilationOverrides][])('rejects %s', async (_name, overrides) => {
    await inContext(pool, ctx(a), async (client) => {
      const resolved =
        overrides.workflowId === ('A' as string | null | undefined)
          ? { ...overrides, workflowId: workflowA }
          : overrides;
      await failing(client, () => insertCompilation(client, a, resolved), CHECK_VIOLATION);
    });
  });

  it.each([
    ['a failed compilation with a fallback', { status: 'failed', hasFallback: true }],
    [
      'a failed compilation with its taxonomy class',
      { status: 'failed', errorClass: 'budget_exhausted', errorCode: 'COMPILER_BUDGET_EXHAUSTED' },
    ],
    ['a succeeded compilation with its node count', { status: 'succeeded', nodeCount: 4 }],
    ['three calls and two repairs', { status: 'succeeded', calls: 3, repairs: 2 }],
  ] as [string, CompilationOverrides][])('accepts %s', async (_name, overrides) => {
    await inContext(pool, ctx(a), (client) => insertCompilation(client, a, overrides));
  });
});

describe('lifecycle of compilations', () => {
  it('moves queued -> running -> succeeded with its metrics', async () => {
    await inContext(pool, ctx(a), async (client) => {
      const id = await insertCompilation(client, a);
      await client.query(
        "UPDATE compilations SET status = 'running', started_at = now() WHERE id = $1",
        [id],
      );
      await client.query('UPDATE compilations SET llm_tokens_used = 900 WHERE id = $1', [id]);
      await client.query(
        `UPDATE compilations
            SET status = 'succeeded', calls = 2, repairs = 1, node_count = 5, cost_micro_usd = 40,
                finished_at = now()
          WHERE id = $1`,
        [id],
      );
      const { rows } = await client.query<{ status: string; llm_tokens_used: number }>(
        'SELECT status, llm_tokens_used FROM compilations WHERE id = $1',
        [id],
      );
      expect(rows[0]).toEqual({ status: 'succeeded', llm_tokens_used: 900 });
    });
  });

  it.each(['succeeded', 'failed'])(
    'is immutable once %s: no state, metric or column changes',
    async (status) => {
      await inContext(pool, ctx(a), async (client) => {
        const id = await insertCompilation(client, a, { status });
        for (const statement of [
          "UPDATE compilations SET status = 'running', finished_at = NULL WHERE id = $1",
          'UPDATE compilations SET llm_tokens_used = llm_tokens_used + 1 WHERE id = $1',
          'UPDATE compilations SET node_count = 1 WHERE id = $1',
          'UPDATE compilations SET error_code = NULL WHERE id = $1',
        ]) {
          await failing(client, () => client.query(statement, [id]), CHECK_VIOLATION);
        }
      });
    },
  );

  it.each([
    ['organization_id', () => `'${b.organizationId}'`],
    ['workflow_id', () => `'${workflowA}'`],
    ['requested_by', () => `'${b.userId}'`],
    ['mode', () => "'regenerate'"],
    ['base_draft_revision', () => '7'],
    ['intent_chars', () => '999'],
    ['model', () => "'other-model'"],
    ['correlation_id', () => `'${randomUUID()}'`],
    ['created_at', () => "'2020-01-01T00:00:00Z'"],
  ])('never changes %s, even while in progress', async (column, value) => {
    await inContext(pool, ctx(a), async (client) => {
      const id = await insertCompilation(client, a);
      await failing(
        client,
        () => client.query(`UPDATE compilations SET ${column} = ${value()} WHERE id = $1`, [id]),
        // The consistency CHECKs may fire before the trigger for some columns.
        CHECK_VIOLATION,
      );
    });
  });
});

describe('llm_calls owned by a compilation', () => {
  let compilationA: string;
  let compilationB: string;

  beforeAll(async () => {
    compilationA = await inContext(pool, ctx(a), (client) => insertCompilation(client, a));
    compilationB = await inContext(pool, ctx(b), (client) => insertCompilation(client, b));
  });

  it('stores a compiler call without run and node', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await insertCall(client, a, { compilationId: compilationA });
      expect(await count(client, 'llm_calls', `compilation_id = '${compilationA}'`)).toBe(1);
    });
  });

  it('keeps one call per provider call: several rows for the same compilation', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await insertCall(client, a, { compilationId: compilationA });
      await insertCall(client, a, { compilationId: compilationA });
      expect(await count(client, 'llm_calls', `compilation_id = '${compilationA}'`)).toBe(3);
    });
  });

  it('isolates the calls of a compilation by organization', async () => {
    await inContext(pool, ctx(b), async (client) => {
      expect(await count(client, 'llm_calls', `compilation_id = '${compilationA}'`)).toBe(0);
    });
  });

  it('still accepts the calls of F5: a run, a node and an llm type', async () => {
    await inContext(pool, ctx(a), (client) =>
      insertCall(client, a, { runId: runA, nodeId: 'ask', nodeType: 'llm.generate' }),
    );
  });

  it.each([
    [
      'a compiler call with a run',
      (c: string): CallOverrides => ({ runId: runA, compilationId: c, nodeType: 'compiler' }),
    ],
    [
      'a compiler call with a node',
      (c: string): CallOverrides => ({ nodeId: 'ask', compilationId: c, nodeType: 'compiler' }),
    ],
    ['a compiler call without a compilation', (): CallOverrides => ({ nodeType: 'compiler' })],
    [
      'an llm call with a compilation',
      (c: string): CallOverrides => ({
        runId: runA,
        nodeId: 'ask',
        compilationId: c,
        nodeType: 'llm.generate',
      }),
    ],
    [
      'an llm call without a node',
      (): CallOverrides => ({ runId: runA, nodeType: 'llm.generate' }),
    ],
    [
      'an llm call without a run',
      (): CallOverrides => ({ nodeId: 'ask', nodeType: 'llm.generate' }),
    ],
    [
      'a call with both owners',
      (c: string): CallOverrides => ({
        runId: runA,
        nodeId: 'ask',
        compilationId: c,
        nodeType: 'compiler',
      }),
    ],
    ['a call without an owner', (): CallOverrides => ({ nodeType: 'llm.generate' })],
    [
      'an unknown node type',
      (c: string): CallOverrides => ({ compilationId: c, nodeType: 'http.request' }),
    ],
  ] as [string, (compilationId: string) => CallOverrides][])('rejects %s', async (_name, build) => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(client, () => insertCall(client, a, build(compilationA)), CHECK_VIOLATION);
    });
  });

  it('rejects a compilation of another organization (the trigger fails closed)', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () => insertCall(client, a, { compilationId: compilationB }),
        CHECK_VIOLATION,
      );
    });
  });

  it('rejects a call whose organization differs from its compilation', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () =>
          insertCall(client, a, {
            compilationId: compilationA,
            organizationId: b.organizationId,
          }),
        CHECK_VIOLATION,
      );
    });
  });

  it('is still immutable and without DELETE', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () =>
          client.query('UPDATE llm_calls SET output_tokens = 1 WHERE compilation_id = $1', [
            compilationA,
          ]),
        INSUFFICIENT_PRIVILEGE,
      );
      await failing(
        client,
        () => client.query('DELETE FROM llm_calls WHERE compilation_id = $1', [compilationA]),
        INSUFFICIENT_PRIVILEGE,
      );
    });
  });
});
