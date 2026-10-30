import { createHash } from 'node:crypto';
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

const TABLES = [
  'workflows',
  'workflow_versions',
  'workflow_active_versions',
  'organization_limits',
] as const;

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

function ctx(tenant: Tenant) {
  return { userId: tenant.userId, organizationId: tenant.organizationId };
}

/** What the API does on creation: the workflow and its active-version row in one transaction. */
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

async function publish(tenant: Tenant, workflowId: string, number: number): Promise<string> {
  return inContext(pool, ctx(tenant), async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO workflow_versions
         (organization_id, workflow_id, version_number, definition, definition_hash,
          node_count, edge_count, node_types, published_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, 1, 0, ARRAY['trigger.manual'], $6) RETURNING id`,
      [
        tenant.organizationId,
        workflowId,
        number,
        EMPTY,
        createHash('sha256').update(EMPTY).digest(),
        tenant.userId,
      ],
    );
    return rows[0]!.id;
  });
}

async function activate(tenant: Tenant, workflowId: string, versionId: string): Promise<void> {
  await inContext(pool, ctx(tenant), (client) =>
    client.query(
      `UPDATE workflow_active_versions
         SET version_id = $2, activated_by = $3, activated_at = now()
         WHERE workflow_id = $1`,
      [workflowId, versionId, tenant.userId],
    ),
  );
}

/** What the operator script does: app_migrator writes through its own policy. */
async function writeLimitsAsOperator(
  operatorPool: pg.Pool,
  rows: [organizationId: string, nodes: number, edges: number, bytes: number][],
): Promise<void> {
  const client = await operatorPool.connect();
  try {
    await client.query('BEGIN');
    for (const [organizationId, nodes, edges, bytes] of rows) {
      await client.query(
        `INSERT INTO organization_limits
           (organization_id, max_nodes, max_edges, max_definition_bytes, updated_by)
         VALUES ($1, $2, $3, $4, 'rls-test')`,
        [organizationId, nodes, edges, bytes],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function count(client: pg.PoolClient, table: string, where = 'true'): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    `SELECT count(*) AS n FROM ${table} WHERE ${where}`,
  );
  return Number(rows[0]!.n);
}

beforeAll(async () => {
  pool = runtimePool();
  migrator = migratorPool();
  a = await createTenant(pool, 'wf-a');
  b = await createTenant(pool, 'wf-b');
  workflowA = await createWorkflow(a, 'Flujo A');
  workflowA2 = await createWorkflow(a, 'Flujo A2');
  workflowB = await createWorkflow(b, 'Flujo B');
  versionA = await publish(a, workflowA, 1);
  versionA2 = await publish(a, workflowA2, 1);
  versionB = await publish(b, workflowB, 1);
  await activate(a, workflowA, versionA);
  await activate(b, workflowB, versionB);
  // The operator, never the API, sets limits (FR-021).
  await writeLimitsAsOperator(migrator, [
    [a.organizationId, 3, 5, 2048],
    [b.organizationId, 4, 6, 4096],
  ]);
});

afterAll(async () => {
  await pool.end();
  await migrator.end();
});

describe('tables of F2', () => {
  it.each(TABLES)('%s has row-level security enabled and forced', async (table) => {
    const { rows } = await migrator.query<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>('SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1', [table]);
    expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('organization_limits has one policy for app_runtime (SELECT) and one for app_migrator', async () => {
    const { rows } = await migrator.query<{ policyname: string; roles: string; cmd: string }>(
      `SELECT policyname, roles::text, cmd FROM pg_policies
        WHERE tablename = 'organization_limits' ORDER BY policyname`,
    );
    expect(rows).toEqual([
      { policyname: 'organization_limits_operator', roles: '{app_migrator}', cmd: 'ALL' },
      { policyname: 'organization_limits_select', roles: '{app_runtime}', cmd: 'SELECT' },
    ]);
  });

  it('grants app_runtime exactly the privileges of data-model.md', async () => {
    const expected: Record<string, string[]> = {
      workflows: ['INSERT', 'SELECT', 'UPDATE'],
      workflow_versions: ['INSERT', 'SELECT'],
      workflow_active_versions: ['INSERT', 'SELECT', 'UPDATE'],
      organization_limits: ['SELECT'],
    };
    for (const [table, privileges] of Object.entries(expected)) {
      const { rows } = await migrator.query<{ privilege_type: string }>(
        `SELECT privilege_type FROM information_schema.role_table_grants
          WHERE grantee = 'app_runtime' AND table_name = $1 ORDER BY privilege_type`,
        [table],
      );
      expect(
        rows.map((row) => row.privilege_type),
        table,
      ).toEqual(privileges);
    }
  });
});

describe('isolation between organizations', () => {
  it('a query without context sees no rows in any table', async () => {
    await inContext(pool, {}, async (client) => {
      for (const table of TABLES) expect(await count(client, table), table).toBe(0);
    });
  });

  it('organization A sees only its own rows in each table', async () => {
    await inContext(pool, ctx(a), async (client) => {
      expect(await count(client, 'workflows', `name IN ('Flujo A', 'Flujo A2', 'Flujo B')`)).toBe(
        2,
      );
      expect(await count(client, 'workflows', `id = '${workflowB}'`)).toBe(0);
      expect(await count(client, 'workflow_versions', `id = '${versionB}'`)).toBe(0);
      expect(await count(client, 'workflow_versions', `id = '${versionA}'`)).toBe(1);
      expect(await count(client, 'workflow_active_versions', `workflow_id = '${workflowB}'`)).toBe(
        0,
      );
      expect(await count(client, 'workflow_active_versions', `workflow_id = '${workflowA}'`)).toBe(
        1,
      );
      expect(await count(client, 'organization_limits')).toBe(1);
      expect(
        await count(client, 'organization_limits', `organization_id = '${b.organizationId}'`),
      ).toBe(0);
    });
  });

  it('cannot update a workflow or an active version of another organization', async () => {
    await inContext(pool, ctx(a), async (client) => {
      const renamed = await client.query(`UPDATE workflows SET name = 'robado' WHERE id = $1`, [
        workflowB,
      ]);
      expect(renamed.rowCount).toBe(0);
      const moved = await client.query(
        `UPDATE workflow_active_versions SET version_id = NULL, activated_by = NULL, activated_at = NULL
          WHERE workflow_id = $1`,
        [workflowB],
      );
      expect(moved.rowCount).toBe(0);
    });
    await inContext(pool, ctx(b), async (client) => {
      expect(await count(client, 'workflows', `id = '${workflowB}' AND name = 'Flujo B'`)).toBe(1);
      expect(
        await count(
          client,
          'workflow_active_versions',
          `workflow_id = '${workflowB}' AND version_id IS NOT NULL`,
        ),
      ).toBe(1);
    });
  });

  it('cannot insert rows for another organization', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await client.query('SAVEPOINT s1');
      await expectSqlError(
        client.query(
          `INSERT INTO workflows (organization_id, name, draft_updated_by, created_by)
           VALUES ($1, 'ajeno', $2, $2)`,
          [b.organizationId, a.userId],
        ),
        INSUFFICIENT_PRIVILEGE,
      );
      await client.query('ROLLBACK TO SAVEPOINT s1');
    });
  });

  it('cannot move a workflow to another organization', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await expectSqlError(
        client.query('UPDATE workflows SET organization_id = $2 WHERE id = $1', [
          workflowA,
          b.organizationId,
        ]),
        INSUFFICIENT_PRIVILEGE,
      );
    });
  });
});

describe('immutable versions and read-only limits (FR-015, FR-021)', () => {
  it('app_runtime cannot UPDATE a version', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await expectSqlError(
        client.query(`UPDATE workflow_versions SET note = 'cambiada' WHERE id = $1`, [versionA]),
        INSUFFICIENT_PRIVILEGE,
      );
    });
  });

  it('app_runtime cannot DELETE or TRUNCATE any table of F2', async () => {
    for (const table of TABLES) {
      await inContext(pool, ctx(a), async (client) => {
        await expectSqlError(client.query(`DELETE FROM ${table}`), INSUFFICIENT_PRIVILEGE);
      });
      await inContext(pool, ctx(a), async (client) => {
        await expectSqlError(client.query(`TRUNCATE ${table}`), INSUFFICIENT_PRIVILEGE);
      });
    }
  });

  it('app_runtime cannot write organization_limits, not even for its own organization', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await expectSqlError(
        client.query('UPDATE organization_limits SET max_nodes = 500 WHERE organization_id = $1', [
          a.organizationId,
        ]),
        INSUFFICIENT_PRIVILEGE,
      );
    });
    await inContext(pool, ctx(a), async (client) => {
      await expectSqlError(
        client.query(
          `INSERT INTO organization_limits (organization_id, max_nodes, max_edges, max_definition_bytes, updated_by)
           VALUES ($1, 5, 5, 2048, 'x')`,
          [a.organizationId],
        ),
        INSUFFICIENT_PRIVILEGE,
      );
    });
  });

  it('the stored definition and its hash are the ones that were published', async () => {
    await inContext(pool, ctx(a), async (client) => {
      const { rows } = await client.query<{ same: boolean }>(
        `SELECT definition_hash = $2 AS same FROM workflow_versions WHERE id = $1`,
        [versionA, createHash('sha256').update(EMPTY).digest()],
      );
      expect(rows[0]!.same).toBe(true);
    });
  });
});

describe('integrity', () => {
  it('rejects a second version with the same number for the workflow', async () => {
    await expectSqlError(publish(a, workflowA, 1), UNIQUE_VIOLATION);
    await expect(publish(a, workflowA, 2)).resolves.toBeTypeOf('string');
  });

  it('the composite foreign key refuses to activate a version of another workflow', async () => {
    // versionA2 belongs to workflowA2, not to workflowA, though both are in organization A.
    await expectSqlError(activate(a, workflowA, versionA2), FOREIGN_KEY_VIOLATION);
  });

  it('refuses a workflow name already used by an active workflow of the organization', async () => {
    await expectSqlError(createWorkflow(a, 'Flujo A'), UNIQUE_VIOLATION);
    // The same name is free in another organization.
    await expect(createWorkflow(b, 'Flujo A')).resolves.toBeTypeOf('string');
  });

  it('keeps the CHECK constraints of data-model.md', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await expectSqlError(
        client.query('UPDATE workflows SET draft_revision = 0 WHERE id = $1', [workflowA]),
        CHECK_VIOLATION,
      );
    });
    await inContext(pool, ctx(a), async (client) => {
      await expectSqlError(
        client.query(`UPDATE workflows SET name = '' WHERE id = $1`, [workflowA]),
        CHECK_VIOLATION,
      );
    });
    await inContext(pool, ctx(a), async (client) => {
      await expectSqlError(
        client.query('UPDATE workflows SET draft_definition = $2::jsonb WHERE id = $1', [
          workflowA,
          JSON.stringify({ schemaVersion: 1, nodes: [], edges: [], pad: 'x'.repeat(1_048_576) }),
        ]),
        CHECK_VIOLATION,
      );
    });
    await inContext(pool, ctx(a), async (client) => {
      await expectSqlError(
        client.query(
          `UPDATE workflow_active_versions SET activated_at = now() WHERE workflow_id = $1 AND version_id IS NULL`,
          [workflowA2],
        ),
        CHECK_VIOLATION,
      );
    });
  });

  it('sets updated_at when a workflow changes', async () => {
    const id = await createWorkflow(a, 'Con reloj');
    const read = (client: pg.PoolClient) =>
      client.query<{ updated_at: Date }>('SELECT updated_at FROM workflows WHERE id = $1', [id]);
    const before = await inContext(pool, ctx(a), (client) => read(client));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await inContext(pool, ctx(a), (client) =>
      client.query(`UPDATE workflows SET name = 'Con reloj 2' WHERE id = $1`, [id]),
    );
    const after = await inContext(pool, ctx(a), (client) => read(client));
    expect(after.rows[0]!.updated_at.getTime()).toBeGreaterThan(
      before.rows[0]!.updated_at.getTime(),
    );
  });
});

describe('same-organization triggers', () => {
  it('refuses a version whose organization differs from its workflow', async () => {
    // Context of A, workflow of A, organization column of B.
    await inContext(pool, ctx(a), async (client) => {
      await expectSqlError(
        client.query(
          `INSERT INTO workflow_versions
             (organization_id, workflow_id, version_number, definition, definition_hash,
              node_count, edge_count, node_types, published_by)
           VALUES ($1, $2, 9, $3::jsonb, $4, 1, 0, ARRAY['trigger.manual'], $5)`,
          [
            b.organizationId,
            workflowA,
            EMPTY,
            createHash('sha256').update(EMPTY).digest(),
            a.userId,
          ],
        ),
        CHECK_VIOLATION,
      );
    });
  });

  it('refuses a version of a workflow of another organization', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await expectSqlError(
        client.query(
          `INSERT INTO workflow_versions
             (organization_id, workflow_id, version_number, definition, definition_hash,
              node_count, edge_count, node_types, published_by)
           VALUES ($1, $2, 9, $3::jsonb, $4, 1, 0, ARRAY['trigger.manual'], $5)`,
          [
            a.organizationId,
            workflowB,
            EMPTY,
            createHash('sha256').update(EMPTY).digest(),
            a.userId,
          ],
        ),
        CHECK_VIOLATION,
      );
    });
  });

  it('refuses an active-version row whose organization differs from its workflow', async () => {
    await inContext(pool, ctx(a), async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO workflows (organization_id, name, draft_updated_by, created_by)
         VALUES ($1, 'Sin fila puente', $2, $2) RETURNING id`,
        [a.organizationId, a.userId],
      );
      await expectSqlError(
        client.query(
          'INSERT INTO workflow_active_versions (workflow_id, organization_id) VALUES ($1, $2)',
          [rows[0]!.id, b.organizationId],
        ),
        CHECK_VIOLATION,
      );
    });
  });
});

describe('archiving deactivates the active version (FR-017)', () => {
  it('clears the active version, keeps the versions and lets the name be reused', async () => {
    const id = await createWorkflow(a, 'Para archivar');
    const version = await publish(a, id, 1);
    await activate(a, id, version);

    await inContext(pool, ctx(a), (client) =>
      client.query('UPDATE workflows SET deleted_at = now() WHERE id = $1', [id]),
    );

    await inContext(pool, ctx(a), async (client) => {
      const { rows } = await client.query(
        'SELECT version_id, activated_by, activated_at FROM workflow_active_versions WHERE workflow_id = $1',
        [id],
      );
      expect(rows[0]).toEqual({ version_id: null, activated_by: null, activated_at: null });
      expect(await count(client, 'workflow_versions', `id = '${version}'`)).toBe(1);
    });
    await expect(createWorkflow(a, 'Para archivar')).resolves.toBeTypeOf('string');
  });

  it('does not touch the active version when other columns change', async () => {
    await inContext(pool, ctx(a), (client) =>
      client.query(`UPDATE workflows SET name = 'Flujo A' WHERE id = $1`, [workflowA]),
    );
    await inContext(pool, ctx(a), async (client) => {
      expect(
        await count(
          client,
          'workflow_active_versions',
          `workflow_id = '${workflowA}' AND version_id = '${versionA}'`,
        ),
      ).toBe(1);
    });
  });
});
