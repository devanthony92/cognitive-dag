import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CREDENTIAL_INSERT,
  activateVersion,
  createWorkflow,
  credentialColumns,
  ctx,
  insertRun,
  publishVersion,
  randomHash,
} from './f7-fixtures.js';
import {
  addMember,
  createTenant,
  expectSqlError,
  inContext,
  migratorPool,
  runtimePool,
  type Tenant,
} from './helpers.js';

const TABLES = [
  'webhook_triggers',
  'workflow_schedules',
  'approvals',
  'credentials',
  'http_allowed_hosts',
] as const;

const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

let pool: pg.Pool;
let migrator: pg.Pool;
let a: Tenant;
let b: Tenant;
let editor: { userId: string };
let viewer: { userId: string };
let workflowA: string;
let workflowA2: string;
let workflowB: string;
let versionA: string;
let versionA2: string;
let versionB: string;

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

async function count(client: pg.PoolClient, table: string, where = 'true'): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    `SELECT count(*) AS n FROM ${table} WHERE ${where}`,
  );
  return Number(rows[0]!.n);
}

async function insertWebhook(
  client: pg.PoolClient,
  tenant: Tenant,
  workflowId: string,
  hash: Buffer = randomHash(),
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO webhook_triggers (organization_id, workflow_id, token_hash, created_by, generated_by)
     VALUES ($1, $2, $3, $4, $4) RETURNING id`,
    [tenant.organizationId, workflowId, hash, tenant.userId],
  );
  return rows[0]!.id;
}

async function insertSchedule(
  client: pg.PoolClient,
  tenant: Tenant,
  workflowId: string,
  versionId: string,
  extra: { syncStatus?: string; syncedAt?: string | null; lastError?: string | null } = {},
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO workflow_schedules
       (organization_id, workflow_id, version_id, cron, timezone, sync_status, synced_at,
        last_error_code)
     VALUES ($1, $2, $3, '0 9 * * *', 'UTC', $4, $5, $6) RETURNING id`,
    [
      tenant.organizationId,
      workflowId,
      versionId,
      extra.syncStatus ?? 'pending',
      extra.syncedAt ?? null,
      extra.lastError ?? null,
    ],
  );
  return rows[0]!.id;
}

async function insertApproval(
  client: pg.PoolClient,
  tenant: Tenant,
  runId: string,
  workflowId: string,
  options: { nodeId?: string; runTriggeredBy?: string | null; expiresInSeconds?: number } = {},
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO approvals
       (organization_id, run_id, workflow_id, node_id, node_label, run_triggered_by, expires_at)
     VALUES ($1, $2, $3, $4, 'Aprobar', $5, now() + make_interval(secs => $6)) RETURNING id`,
    [
      tenant.organizationId,
      runId,
      workflowId,
      options.nodeId ?? 'approve',
      options.runTriggeredBy === undefined ? tenant.userId : options.runTriggeredBy,
      options.expiresInSeconds ?? 3600,
    ],
  );
  return rows[0]!.id;
}

async function insertHost(client: pg.PoolClient, tenant: Tenant, pattern: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO http_allowed_hosts (organization_id, pattern, created_by)
     VALUES ($1, $2, $3) RETURNING id`,
    [tenant.organizationId, pattern, tenant.userId],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  pool = runtimePool();
  migrator = migratorPool();
  a = await createTenant(pool, 'f7-a');
  b = await createTenant(pool, 'f7-b');
  editor = await addMember(pool, a.organizationId, 'editor', 'editor');
  viewer = await addMember(pool, a.organizationId, 'viewer', 'viewer');
  workflowA = await createWorkflow(pool, a, 'Flujo A');
  workflowA2 = await createWorkflow(pool, a, 'Flujo A2');
  workflowB = await createWorkflow(pool, b, 'Flujo B');
  versionA = await publishVersion(pool, a, workflowA);
  versionA2 = await publishVersion(pool, a, workflowA2);
  versionB = await publishVersion(pool, b, workflowB);
});

afterAll(async () => {
  await pool.end();
  await migrator.end();
});

describe('catalog of the F7 tables', () => {
  it.each(TABLES)('%s has row-level security enabled and forced', async (table) => {
    const { rows } = await migrator.query<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>('SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1', [table]);
    expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it.each(TABLES)('app_runtime cannot DELETE or TRUNCATE %s', async (table) => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(client, () => client.query(`DELETE FROM ${table}`), INSUFFICIENT_PRIVILEGE);
      await failing(client, () => client.query(`TRUNCATE ${table}`), INSUFFICIENT_PRIVILEGE);
    });
  });
});

describe('isolation between organizations', () => {
  it('shows each organization only its own rows in the five tables', async () => {
    const aRows = await inContext(pool, ctx(a), async (client) => {
      const hook = await insertWebhook(client, a, workflowA);
      const schedule = await insertSchedule(client, a, workflowA, versionA);
      const run = await insertRun(client, a, workflowA, versionA);
      const approval = await insertApproval(client, a, run, workflowA);
      const { rows } = await client.query<{ id: string }>(CREDENTIAL_INSERT, credentialColumns(a));
      const host = await insertHost(client, a, 'isolation.example.com');
      return { hook, schedule, approval, credential: rows[0]!.id, host };
    });
    await inContext(pool, ctx(b), async (client) => {
      for (const table of TABLES) expect(await count(client, table)).toBe(0);
    });
    await inContext(pool, ctx(a), async (client) => {
      expect(await count(client, 'webhook_triggers', `id = '${aRows.hook}'`)).toBe(1);
      expect(await count(client, 'credentials', `id = '${aRows.credential}'`)).toBe(1);
    });
    // Without a context nothing is visible.
    await inContext(pool, {}, async (client) => {
      for (const table of TABLES) expect(await count(client, table)).toBe(0);
    });
  });

  it('refuses to write a row of another organization', async () => {
    await inContext(pool, ctx(b), async (client) => {
      await failing(
        client,
        () =>
          client.query(
            `INSERT INTO http_allowed_hosts (organization_id, pattern, created_by)
             VALUES ($1, 'foreign.example.com', $2)`,
            [a.organizationId, b.userId],
          ),
        INSUFFICIENT_PRIVILEGE,
      );
      await failing(
        client,
        // The same-organization trigger fires before the policy and fails closed.
        () => client.query(CREDENTIAL_INSERT, credentialColumns(a, { createdBy: b.userId })),
        CHECK_VIOLATION,
      );
    });
  });
});

describe('same-organization triggers', () => {
  it('rejects a webhook for a workflow of another organization', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(client, () => insertWebhook(client, a, workflowB), CHECK_VIOLATION);
    });
  });

  it('rejects a schedule whose workflow or version belongs to another organization', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(client, () => insertSchedule(client, a, workflowB, versionB), CHECK_VIOLATION);
      await failing(client, () => insertSchedule(client, a, workflowA, versionB), CHECK_VIOLATION);
    });
  });

  it('rejects an approval for a run of another organization', async () => {
    const runB = await inContext(pool, ctx(b), (client) =>
      insertRun(client, b, workflowB, versionB),
    );
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () => insertApproval(client, a, runB, workflowB, { runTriggeredBy: b.userId }),
        CHECK_VIOLATION,
      );
    });
  });

  it('requires the approval to copy the workflow and the requester of its run', async () => {
    await inContext(pool, ctx(a), async (client) => {
      const run = await insertRun(client, a, workflowA, versionA);
      await failing(
        client,
        () => insertApproval(client, a, run, workflowA, { runTriggeredBy: editor.userId }),
        CHECK_VIOLATION,
      );
      await failing(client, () => insertApproval(client, a, run, workflowA2), CHECK_VIOLATION);
    });
  });

  it('requires the creator of a credential to belong to the organization', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () => client.query(CREDENTIAL_INSERT, credentialColumns(a, { createdBy: b.userId })),
        CHECK_VIOLATION,
      );
    });
  });
});

describe('webhook_triggers', () => {
  it('is readable by its own id with the lookup key, and never writable', async () => {
    const { own, other } = await inContext(pool, ctx(a), async (client) => ({
      own: await insertWebhook(client, a, workflowA2),
      other: randomUUID(),
    }));
    await inContext(pool, { lookupWebhookTriggerId: own }, async (client) => {
      const { rows } = await client.query<{ id: string; organization_id: string }>(
        'SELECT id, organization_id FROM webhook_triggers',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.organization_id).toBe(a.organizationId);
      const updated = await client.query('UPDATE webhook_triggers SET generated_at = now()');
      expect(updated.rowCount).toBe(0);
      // Nothing is visible to write under the lookup key alone: the insert fails closed.
      await failing(client, () => insertWebhook(client, a, workflowA), CHECK_VIOLATION);
    });
    await inContext(pool, { lookupWebhookTriggerId: other }, async (client) => {
      expect(await count(client, 'webhook_triggers')).toBe(0);
    });
  });

  it('allows one webhook per workflow', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(client, () => insertWebhook(client, a, workflowA2), UNIQUE_VIOLATION);
    });
  });

  it('checks the size of the hash', async () => {
    await inContext(pool, ctx(b), async (client) => {
      await failing(
        client,
        () => insertWebhook(client, b, workflowB, Buffer.alloc(16)),
        CHECK_VIOLATION,
      );
    });
  });

  it('regenerates the token raising the generation by exactly one', async () => {
    await inContext(pool, ctx(b), async (client) => {
      const id = await insertWebhook(client, b, workflowB);
      await failing(
        client,
        () =>
          client.query('UPDATE webhook_triggers SET token_hash = $2 WHERE id = $1', [
            id,
            randomHash(),
          ]),
        CHECK_VIOLATION,
      );
      await failing(
        client,
        () =>
          client.query(
            'UPDATE webhook_triggers SET token_hash = $2, generation = 3 WHERE id = $1',
            [id, randomHash()],
          ),
        CHECK_VIOLATION,
      );
      await failing(
        client,
        () => client.query('UPDATE webhook_triggers SET generation = 2 WHERE id = $1', [id]),
        CHECK_VIOLATION,
      );
      await client.query(
        'UPDATE webhook_triggers SET token_hash = $2, generation = 2, generated_at = now() WHERE id = $1',
        [id, randomHash()],
      );
      await failing(
        client,
        () =>
          client.query('UPDATE webhook_triggers SET workflow_id = $2 WHERE id = $1', [
            id,
            workflowA,
          ]),
        CHECK_VIOLATION,
      );
    });
  });
});

describe('workflow_schedules', () => {
  it('lets the reconciler read only what is not synced, and never write', async () => {
    const wf = await createWorkflow(pool, b, 'Con programación');
    const version = await publishVersion(pool, b, wf);
    const { pending, synced } = await inContext(pool, ctx(b), async (client) => {
      const wf2 = await createWorkflow(pool, b, 'Sincronizado');
      const v2 = await publishVersion(pool, b, wf2);
      return {
        pending: await insertSchedule(client, b, wf, version),
        synced: await insertSchedule(client, b, wf2, v2, {
          syncStatus: 'synced',
          syncedAt: new Date().toISOString(),
        }),
      };
    });
    await inContext(pool, { reconciler: 'schedules' }, async (client) => {
      const { rows } = await client.query<{ id: string }>('SELECT id FROM workflow_schedules');
      const ids = rows.map((row) => row.id);
      expect(ids).toContain(pending);
      expect(ids).not.toContain(synced);
      const updated = await client.query("UPDATE workflow_schedules SET sync_status = 'synced'");
      expect(updated.rowCount).toBe(0);
    });
    await inContext(pool, { reconciler: 'other' }, async (client) => {
      expect(await count(client, 'workflow_schedules')).toBe(0);
    });
  });

  it('keeps sync_status and the error code consistent', async () => {
    await inContext(pool, ctx(a), async (client) => {
      await failing(
        client,
        () => insertSchedule(client, a, workflowA2, versionA2, { syncStatus: 'synced' }),
        CHECK_VIOLATION,
      );
      await failing(
        client,
        () => insertSchedule(client, a, workflowA2, versionA2, { syncStatus: 'failed' }),
        CHECK_VIOLATION,
      );
      await failing(
        client,
        () => insertSchedule(client, a, workflowA2, versionA2, { lastError: 'SCHEDULE_FAILED' }),
        CHECK_VIOLATION,
      );
    });
  });

  it('validates its columns and keeps its keys', async () => {
    const wf = await createWorkflow(pool, a, `Programado ${randomUUID().slice(0, 6)}`);
    const version = await publishVersion(pool, a, wf);
    await inContext(pool, ctx(a), async (client) => {
      const id = await insertSchedule(client, a, wf, version);
      await failing(
        client,
        () =>
          client.query("UPDATE workflow_schedules SET desired_state = 'paused' WHERE id = $1", [
            id,
          ]),
        CHECK_VIOLATION,
      );
      await failing(
        client,
        () => client.query("UPDATE workflow_schedules SET cron = '* *' WHERE id = $1", [id]),
        CHECK_VIOLATION,
      );
      await failing(
        client,
        () =>
          client.query('UPDATE workflow_schedules SET workflow_id = $2 WHERE id = $1', [
            id,
            workflowA,
          ]),
        CHECK_VIOLATION,
      );
      await client.query(
        "UPDATE workflow_schedules SET sync_status = 'failed', last_error_code = 'TEMPORAL_DOWN', sync_attempts = 1 WHERE id = $1",
        [id],
      );
    });
  });
});

describe('approvals', () => {
  it('checks its consistency rules', async () => {
    await inContext(pool, ctx(a), async (client) => {
      const run = await insertRun(client, a, workflowA, versionA);
      await failing(
        client,
        () => insertApproval(client, a, run, workflowA, { expiresInSeconds: -5 }),
        CHECK_VIOLATION,
      );
      await failing(
        client,
        () => insertApproval(client, a, run, workflowA, { nodeId: 'Bad-Id' }),
        CHECK_VIOLATION,
      );
      const id = await insertApproval(client, a, run, workflowA);
      await failing(client, () => insertApproval(client, a, run, workflowA), UNIQUE_VIOLATION);
      // A final status needs its resolution date.
      await failing(
        client,
        () => client.query("UPDATE approvals SET status = 'timed_out' WHERE id = $1", [id]),
        CHECK_VIOLATION,
      );
      await failing(
        client,
        () => client.query('UPDATE approvals SET has_comment = true WHERE id = $1', [id]),
        CHECK_VIOLATION,
      );
      await failing(
        client,
        () => client.query('UPDATE approvals SET notified_count = 21 WHERE id = $1', [id]),
        CHECK_VIOLATION,
      );
      await client.query('UPDATE approvals SET notified_count = 3 WHERE id = $1', [id]);
    });
  });

  it('refuses the person who started the run and members who cannot decide', async () => {
    await inContext(pool, ctx(a), async (client) => {
      const run = await insertRun(client, a, workflowA, versionA);
      const id = await insertApproval(client, a, run, workflowA);
      const decide = (userId: string) =>
        client.query(
          "UPDATE approvals SET status = 'approved', decided_by = $2, resolved_at = now() WHERE id = $1",
          [id, userId],
        );
      await failing(client, () => decide(a.userId), CHECK_VIOLATION);
      await failing(client, () => decide(viewer.userId), CHECK_VIOLATION);
      await failing(client, () => decide(b.userId), CHECK_VIOLATION);
      await decide(editor.userId);
    });
  });

  it('lets any owner or editor decide a run started by a webhook', async () => {
    await inContext(pool, ctx(a), async (client) => {
      const run = await insertRun(client, a, workflowA, versionA, {
        triggeredBy: null,
        triggerKind: 'webhook',
        triggerEventId: `evt-${randomUUID()}`,
      });
      const id = await insertApproval(client, a, run, workflowA, { runTriggeredBy: null });
      await client.query(
        "UPDATE approvals SET status = 'rejected', decided_by = $2, resolved_at = now(), has_comment = true WHERE id = $1",
        [id, a.userId],
      );
    });
  });

  it('never changes once final, nor its identifying columns', async () => {
    await inContext(pool, ctx(a), async (client) => {
      const run = await insertRun(client, a, workflowA, versionA);
      const id = await insertApproval(client, a, run, workflowA);
      await failing(
        client,
        () => client.query("UPDATE approvals SET node_label = 'Otra' WHERE id = $1", [id]),
        CHECK_VIOLATION,
      );
      await failing(
        client,
        () =>
          client.query(
            "UPDATE approvals SET expires_at = expires_at + interval '1 day' WHERE id = $1",
            [id],
          ),
        CHECK_VIOLATION,
      );
      await client.query(
        "UPDATE approvals SET status = 'timed_out', resolved_at = now() WHERE id = $1",
        [id],
      );
      await failing(
        client,
        () => client.query('UPDATE approvals SET notified_count = 1 WHERE id = $1', [id]),
        CHECK_VIOLATION,
      );
      await failing(
        client,
        () => client.query("UPDATE approvals SET status = 'cancelled' WHERE id = $1", [id]),
        CHECK_VIOLATION,
      );
    });
  });
});

describe('credentials', () => {
  it('enforces the sizes of the encrypted columns', async () => {
    await inContext(pool, ctx(b), async (client) => {
      await failing(
        client,
        () => client.query(CREDENTIAL_INSERT, credentialColumns(b, { secretCt: Buffer.alloc(0) })),
        CHECK_VIOLATION,
      );
      await failing(
        client,
        () =>
          client.query(CREDENTIAL_INSERT, credentialColumns(b, { secretCt: Buffer.alloc(4097) })),
        CHECK_VIOLATION,
      );
    });
  });

  it('ties header_name to the api_key_header kind and rejects reserved names', async () => {
    await inContext(pool, ctx(b), async (client) => {
      await failing(
        client,
        () => client.query(CREDENTIAL_INSERT, credentialColumns(b, { kind: 'api_key_header' })),
        CHECK_VIOLATION,
      );
      await failing(
        client,
        () => client.query(CREDENTIAL_INSERT, credentialColumns(b, { headerName: 'X-Key' })),
        CHECK_VIOLATION,
      );
      for (const name of [
        'Authorization',
        'host',
        'Proxy-Authorization',
        'Idempotency-Key',
        'bad name',
      ]) {
        await failing(
          client,
          () =>
            client.query(
              CREDENTIAL_INSERT,
              credentialColumns(b, { kind: 'api_key_header', headerName: name }),
            ),
          CHECK_VIOLATION,
        );
      }
      await client.query(
        CREDENTIAL_INSERT,
        credentialColumns(b, { kind: 'api_key_header', headerName: 'X-Api-Key' }),
      );
    });
  });

  it('keeps names unique among live credentials and frees them on archive', async () => {
    await inContext(pool, ctx(b), async (client) => {
      const first = await client.query<{ id: string }>(
        CREDENTIAL_INSERT,
        credentialColumns(b, { name: 'unica' }),
      );
      await failing(
        client,
        () => client.query(CREDENTIAL_INSERT, credentialColumns(b, { name: 'unica' })),
        UNIQUE_VIOLATION,
      );
      await client.query(
        'UPDATE credentials SET archived_by = $2, archived_at = now() WHERE id = $1',
        [first.rows[0]!.id, b.userId],
      );
      await client.query(CREDENTIAL_INSERT, credentialColumns(b, { name: 'unica' }));
    });
  });

  it('keeps its keys, never changes once archived and never lowers the key version', async () => {
    await inContext(pool, ctx(b), async (client) => {
      const { rows } = await client.query<{ id: string }>(CREDENTIAL_INSERT, credentialColumns(b));
      const id = rows[0]!.id;
      await failing(
        client,
        () => client.query("UPDATE credentials SET kind = 'basic' WHERE id = $1", [id]),
        CHECK_VIOLATION,
      );
      await failing(
        client,
        () => client.query('UPDATE credentials SET key_version = 0 WHERE id = $1', [id]),
        CHECK_VIOLATION,
      );
      await failing(
        client,
        () => client.query('UPDATE credentials SET rotated_by = $2 WHERE id = $1', [id, b.userId]),
        CHECK_VIOLATION,
      );
      await client.query(
        'UPDATE credentials SET rotated_by = $2, rotated_at = now(), key_version = 2 WHERE id = $1',
        [id, b.userId],
      );
      await failing(
        client,
        () => client.query('UPDATE credentials SET key_version = 1 WHERE id = $1', [id]),
        CHECK_VIOLATION,
      );
      await client.query(
        'UPDATE credentials SET archived_by = $2, archived_at = now() WHERE id = $1',
        [id, b.userId],
      );
      await failing(
        client,
        () =>
          client.query('UPDATE credentials SET secret_ct = $2 WHERE id = $1', [
            id,
            Buffer.alloc(8, 1),
          ]),
        CHECK_VIOLATION,
      );
    });
  });
});

describe('http_allowed_hosts', () => {
  it('accepts exact and wildcard domains and rejects IPs, ports and paths', async () => {
    await inContext(pool, ctx(b), async (client) => {
      await insertHost(client, b, 'api.example.com');
      await insertHost(client, b, '*.example.org');
      for (const pattern of [
        '10.0.0.1',
        '1.2.3.*',
        'example.com:443',
        'https://example.com',
        'example.com/path',
        'Example.COM',
        'localhost',
        '*.com.',
        '::1',
      ]) {
        await failing(client, () => insertHost(client, b, pattern), CHECK_VIOLATION);
      }
      await failing(client, () => insertHost(client, b, 'api.example.com'), UNIQUE_VIOLATION);
    });
  });

  it('only retires an entry, once, and frees its pattern', async () => {
    await inContext(pool, ctx(b), async (client) => {
      const id = await insertHost(client, b, 'retire.example.com');
      await failing(
        client,
        () =>
          client.query("UPDATE http_allowed_hosts SET pattern = 'x.example.com' WHERE id = $1", [
            id,
          ]),
        CHECK_VIOLATION,
      );
      await failing(
        client,
        () => client.query('UPDATE http_allowed_hosts SET removed_at = now() WHERE id = $1', [id]),
        CHECK_VIOLATION,
      );
      await client.query(
        'UPDATE http_allowed_hosts SET removed_by = $2, removed_at = now() WHERE id = $1',
        [id, b.userId],
      );
      await failing(
        client,
        () =>
          client.query(
            'UPDATE http_allowed_hosts SET removed_by = $2, removed_at = now() WHERE id = $1',
            [id, b.userId],
          ),
        CHECK_VIOLATION,
      );
      await insertHost(client, b, 'retire.example.com');
    });
  });

  it('rejects the 101st live entry of an organization', async () => {
    const c = await createTenant(pool, 'f7-hosts');
    await inContext(pool, ctx(c), async (client) => {
      for (let i = 0; i < 100; i++) await insertHost(client, c, `h${i}.example.com`);
      await failing(client, () => insertHost(client, c, 'h100.example.com'), CHECK_VIOLATION);
      // Retiring one makes room.
      await client.query(
        "UPDATE http_allowed_hosts SET removed_by = $1, removed_at = now() WHERE pattern = 'h0.example.com'",
        [c.userId],
      );
      await insertHost(client, c, 'h100.example.com');
    });
  });
});

describe('workflow_runs of the triggers', () => {
  it('keeps F3-F6 rows valid: manual with a person and the default kind', async () => {
    await inContext(pool, ctx(a), async (client) => {
      const run = await insertRun(client, a, workflowA, versionA);
      const { rows } = await client.query(
        'SELECT trigger_kind, triggered_by, trigger_event_id, scheduled_at FROM workflow_runs WHERE id = $1',
        [run],
      );
      expect(rows[0]).toEqual({
        trigger_kind: 'manual',
        triggered_by: a.userId,
        trigger_event_id: null,
        scheduled_at: null,
      });
    });
  });

  it('enforces workflow_runs_trigger_consistent', async () => {
    await inContext(pool, ctx(a), async (client) => {
      const event = () => `evt-${randomUUID()}`;
      const at = new Date().toISOString();
      // Manual without a person.
      await failing(
        client,
        () => insertRun(client, a, workflowA, versionA, { triggeredBy: null }),
        CHECK_VIOLATION,
      );
      // Webhook with a person, without an event id, or with a schedule time.
      await failing(
        client,
        () =>
          insertRun(client, a, workflowA, versionA, {
            triggerKind: 'webhook',
            triggerEventId: event(),
          }),
        CHECK_VIOLATION,
      );
      await failing(
        client,
        () =>
          insertRun(client, a, workflowA, versionA, { triggerKind: 'webhook', triggeredBy: null }),
        CHECK_VIOLATION,
      );
      await failing(
        client,
        () =>
          insertRun(client, a, workflowA, versionA, {
            triggerKind: 'webhook',
            triggeredBy: null,
            triggerEventId: event(),
            scheduledAt: at,
          }),
        CHECK_VIOLATION,
      );
      // Schedule without a time, or with an event id.
      await failing(
        client,
        () =>
          insertRun(client, a, workflowA, versionA, { triggerKind: 'schedule', triggeredBy: null }),
        CHECK_VIOLATION,
      );
      await failing(
        client,
        () =>
          insertRun(client, a, workflowA, versionA, {
            triggerKind: 'schedule',
            triggeredBy: null,
            scheduledAt: at,
            triggerEventId: event(),
          }),
        CHECK_VIOLATION,
      );
      // Unknown kind.
      await failing(
        client,
        () => insertRun(client, a, workflowA, versionA, { triggerKind: 'telepathy' }),
        CHECK_VIOLATION,
      );
      // The valid shapes.
      await insertRun(client, a, workflowA, versionA, {
        triggerKind: 'webhook',
        triggeredBy: null,
        triggerEventId: event(),
      });
      const scheduled = await insertRun(client, a, workflowA, versionA, {
        triggerKind: 'schedule',
        triggeredBy: null,
        scheduledAt: at,
      });
      // A webhook or a schedule run is never a rerun.
      const original = await insertRun(client, a, workflowA, versionA);
      await failing(
        client,
        () =>
          insertRun(client, a, workflowA, versionA, {
            triggerKind: 'schedule',
            triggeredBy: null,
            scheduledAt: at,
            rerunOf: original,
          }),
        CHECK_VIOLATION,
      );
      // What fired a run never changes.
      await failing(
        client,
        () =>
          client.query(
            "UPDATE workflow_runs SET scheduled_at = now() + interval '1 day' WHERE id = $1",
            [scheduled],
          ),
        CHECK_VIOLATION,
      );
    });
  });

  it('accepts the new waiting reasons of a running step', async () => {
    await inContext(pool, ctx(a), async (client) => {
      const run = await insertRun(client, a, workflowA, versionA);
      for (const [index, reason] of ['rate_limited', 'approval', 'circuit_open'].entries()) {
        await client.query(
          `INSERT INTO workflow_run_steps (organization_id, run_id, node_id, node_type, status, waiting_reason)
           VALUES ($1, $2, $3, 'human.approval', 'running', $4)`,
          [a.organizationId, run, `n${index}`, reason],
        );
      }
      await failing(
        client,
        () =>
          client.query(
            `INSERT INTO workflow_run_steps (organization_id, run_id, node_id, node_type, status, waiting_reason)
             VALUES ($1, $2, 'bad', 'human.approval', 'running', 'sleeping')`,
            [a.organizationId, run],
          ),
        CHECK_VIOLATION,
      );
    });
  });

  it('activating a version works with the new columns (bridge stays valid)', async () => {
    await activateVersion(pool, a, workflowA, versionA);
    await inContext(pool, ctx(a), async (client) => {
      expect(await count(client, 'workflow_active_versions', `workflow_id = '${workflowA}'`)).toBe(
        1,
      );
    });
  });
});
