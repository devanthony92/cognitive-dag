import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWithContext, startRun, type Database, type StartRunParams } from '../src/index.js';
import { activateVersion, createWorkflow, ctx, insertRun, publishVersion } from './f7-fixtures.js';
import { createTenant, inContext, runtimePool, type Tenant } from './helpers.js';

let pool: pg.Pool;
let withContext: ReturnType<typeof createWithContext>;

beforeAll(() => {
  pool = runtimePool();
  withContext = createWithContext(drizzle(pool) as unknown as Database);
});

afterAll(async () => {
  await pool.end();
});

interface Fixture {
  tenant: Tenant;
  workflowId: string;
  versionId: string;
}

async function fixture(label: string, activate = true): Promise<Fixture> {
  const tenant = await createTenant(pool, label);
  const workflowId = await createWorkflow(pool, tenant, `Flujo ${label}`);
  const versionId = await publishVersion(pool, tenant, workflowId);
  if (activate) await activateVersion(pool, tenant, workflowId, versionId);
  return { tenant, workflowId, versionId };
}

function params(f: Fixture, trigger: StartRunParams['trigger'], max = 5): StartRunParams {
  return {
    organizationId: f.tenant.organizationId,
    workflowId: f.workflowId,
    correlationId: randomUUID(),
    trigger,
    defaultMaxConcurrentRuns: max,
    temporalWorkflowId: (runId) =>
      trigger.kind === 'webhook' ? `hook-${f.workflowId}-${trigger.eventId}` : `run-${runId}`,
  };
}

describe('startRun', () => {
  it('starts a manual run of the active version', async () => {
    const f = await fixture('start-manual');
    const result = await withContext(ctx(f.tenant), (tx) =>
      startRun(tx, params(f, { kind: 'manual', userId: f.tenant.userId })),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.run).toMatchObject({
      status: 'queued',
      triggerKind: 'manual',
      triggeredBy: f.tenant.userId,
      versionId: f.versionId,
      temporalWorkflowId: `run-${result.run.id}`,
    });
    expect(result.version.versionNumber).toBe(1);
  });

  it('starts a webhook run without a person, deduplicated by its event id', async () => {
    const f = await fixture('start-webhook');
    const first = await withContext(ctx(f.tenant), (tx) =>
      startRun(tx, params(f, { kind: 'webhook', eventId: 'evt-1' })),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.run).toMatchObject({
      triggerKind: 'webhook',
      triggeredBy: null,
      triggerEventId: 'evt-1',
      temporalWorkflowId: `hook-${f.workflowId}-evt-1`,
    });
    const again = await withContext(ctx(f.tenant), (tx) =>
      startRun(tx, params(f, { kind: 'webhook', eventId: 'evt-1' })),
    );
    expect(again).toEqual({ ok: false, reason: 'duplicate_event', runId: first.run.id });
    const other = await withContext(ctx(f.tenant), (tx) =>
      startRun(tx, params(f, { kind: 'webhook', eventId: 'evt-2' })),
    );
    expect(other.ok).toBe(true);
  });

  it('starts a scheduled run with its programmed time', async () => {
    const f = await fixture('start-schedule');
    const scheduledAt = new Date('2026-11-07T09:00:00.000Z');
    const result = await withContext(ctx(f.tenant), (tx) =>
      startRun(tx, params(f, { kind: 'schedule', scheduledAt })),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.run).toMatchObject({ triggerKind: 'schedule', triggeredBy: null });
    expect(result.run.scheduledAt?.toISOString()).toBe(scheduledAt.toISOString());
  });

  it('keeps a rerun on the pinned version', async () => {
    const f = await fixture('start-rerun');
    const v2 = await publishVersion(pool, f.tenant, f.workflowId, 2);
    await activateVersion(pool, f.tenant, f.workflowId, v2);
    const original = await inContext(pool, ctx(f.tenant), (client) =>
      insertRun(client, f.tenant, f.workflowId, f.versionId),
    );
    const result = await withContext(ctx(f.tenant), (tx) =>
      startRun(tx, {
        ...params(f, { kind: 'manual', userId: f.tenant.userId, rerunOf: original }),
        pinnedVersionId: f.versionId,
      }),
    );
    expect(result.ok && result.run.versionId).toBe(f.versionId);
    expect(result.ok && result.run.rerunOf).toBe(original);
  });

  it('refuses a workflow without an active version, unknown or archived', async () => {
    const f = await fixture('start-refuse', false);
    const noVersion = await withContext(ctx(f.tenant), (tx) =>
      startRun(tx, params(f, { kind: 'manual', userId: f.tenant.userId })),
    );
    expect(noVersion).toEqual({ ok: false, reason: 'no_active_version' });
    const unknown = await withContext(ctx(f.tenant), (tx) =>
      startRun(tx, {
        ...params(f, { kind: 'manual', userId: f.tenant.userId }),
        workflowId: randomUUID(),
      }),
    );
    expect(unknown).toEqual({ ok: false, reason: 'workflow_not_found' });
    await inContext(pool, ctx(f.tenant), (client) =>
      client.query('UPDATE workflows SET deleted_at = now() WHERE id = $1', [f.workflowId]),
    );
    const gone = await withContext(ctx(f.tenant), (tx) =>
      startRun(tx, params(f, { kind: 'manual', userId: f.tenant.userId })),
    );
    expect(gone).toEqual({ ok: false, reason: 'workflow_archived' });
  });

  it('applies the concurrency limit, with the organization limit when there is one', async () => {
    const f = await fixture('start-limit');
    const start = () =>
      withContext(ctx(f.tenant), (tx) =>
        startRun(tx, params(f, { kind: 'manual', userId: f.tenant.userId }, 2)),
      );
    expect((await start()).ok).toBe(true);
    expect((await start()).ok).toBe(true);
    expect(await start()).toEqual({
      ok: false,
      reason: 'run_limit_reached',
      inProgress: 2,
      limit: 2,
    });
  });

  it('does not count runs with a pending approval, and counts them again once resolved', async () => {
    const f = await fixture('start-approval');
    const { run, approval } = await inContext(pool, ctx(f.tenant), async (client) => {
      const run = await insertRun(client, f.tenant, f.workflowId, f.versionId, {
        status: 'running',
      });
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO approvals
           (organization_id, run_id, workflow_id, node_id, node_label, run_triggered_by, expires_at)
         VALUES ($1, $2, $3, 'approve', 'Aprobar', $4, now() + interval '1 hour') RETURNING id`,
        [f.tenant.organizationId, run, f.workflowId, f.tenant.userId],
      );
      return { run, approval: rows[0]!.id };
    });
    void run;
    const start = () =>
      withContext(ctx(f.tenant), (tx) =>
        startRun(tx, params(f, { kind: 'manual', userId: f.tenant.userId }, 1)),
      );
    // The only run in progress waits for a person, so the limit of 1 still has room.
    expect((await start()).ok).toBe(true);
    // Now the new queued run fills it.
    expect((await start()).ok).toBe(false);
    await inContext(pool, ctx(f.tenant), (client) =>
      client.query("UPDATE approvals SET status = 'timed_out', resolved_at = now() WHERE id = $1", [
        approval,
      ]),
    );
    const afterResolve = await start();
    expect(afterResolve).toMatchObject({ ok: false, reason: 'run_limit_reached', inProgress: 2 });
  });

  it('never lets concurrent starts exceed the limit', async () => {
    const f = await fixture('start-race');
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        withContext(ctx(f.tenant), (tx) =>
          startRun(tx, params(f, { kind: 'manual', userId: f.tenant.userId }, 3)),
        ),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(3);
  });
});
