import { randomUUID } from 'node:crypto';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, approvals, createDatabase, eq, type DatabaseClient } from '@cognitive-dag/db';
import { createLogger } from '@cognitive-dag/logger';
import { createApprovalActivities } from '../../src/approvals/activities';
import { approvalRequestedEmail, type ApprovalMail, type Mailer } from '../../src/approvals/mail';
import { parseEnv } from '../../src/config/env.schema';
import { loadLocalEnv } from '../../src/config/load-env';
import { definition, edge, mock, node, trigger } from '../helpers/dags';
import { seedRun, type SeededRun } from '../integration/support/seed';
import { eventsOf, runEngine, waitFor } from '../support/engine';

loadLocalEnv();
const config = parseEnv(process.env);
const logger = createLogger({ component: 'worker-test', level: 'silent' });
const EMPTY = { schemaVersion: 1, nodes: [], edges: [] };
const SECRET_MESSAGE = 'El pedido 4411 de Ana Pérez necesita aprobación';

function recordingMailer(options: { fail?: boolean } = {}): Mailer & { sent: ApprovalMail[] } {
  const sent: ApprovalMail[] = [];
  return {
    sent,
    send(message) {
      if (options.fail) return Promise.reject(new Error('SMTP unreachable'));
      sent.push(message);
      return Promise.resolve();
    },
    close: () => undefined,
  };
}

describe('notifyApprovers (requires docker compose up)', () => {
  let database: DatabaseClient;
  let pool: pg.Pool;

  beforeAll(() => {
    database = createDatabase({ connectionString: config.DATABASE_URL, max: 4 });
    pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
  });

  afterAll(async () => {
    await pool.end();
    await database.end();
  });

  async function addMember(run: SeededRun, role: 'owner' | 'editor' | 'viewer', label: string) {
    const userId = randomUUID();
    const email = `${label}-${userId.slice(0, 8)}@example.test`;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.organization_id', $1, true)", [
        run.organizationId,
      ]);
      await client.query(
        'INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)',
        [userId, email, label, '$argon2id$test'],
      );
      await client.query(
        'INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3)',
        [run.organizationId, userId, role],
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    return { userId, email };
  }

  /** A run fired by a webhook: no person started it. */
  async function webhookRun(run: SeededRun): Promise<SeededRun> {
    const runId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.organization_id', $1, true)", [
        run.organizationId,
      ]);
      await client.query(
        `INSERT INTO workflow_runs
           (id, organization_id, workflow_id, version_id, version_number, triggered_by,
            trigger_kind, trigger_event_id, correlation_id, temporal_workflow_id)
         VALUES ($1, $2, $3, $4, 1, NULL, 'webhook', $5, $6, $7)`,
        [
          runId,
          run.organizationId,
          run.workflowId,
          run.versionId,
          `evt-${runId}`,
          randomUUID(),
          `hook-${runId}`,
        ],
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    return { ...run, runId };
  }

  async function pending(run: SeededRun, runTriggeredBy: string | null = run.userId) {
    await database.withContext({ organizationId: run.organizationId }, (tx) =>
      tx.insert(approvals).values({
        organizationId: run.organizationId,
        runId: run.runId,
        workflowId: run.workflowId,
        nodeId: 'ask',
        nodeLabel: 'Aprobar pedido',
        runTriggeredBy,
        expiresAt: new Date(Date.now() + 3_600_000),
      }),
    );
  }

  const notifiedCount = async (run: SeededRun) =>
    (
      await database.withContext({ organizationId: run.organizationId }, (tx) =>
        tx
          .select({ n: approvals.notifiedCount })
          .from(approvals)
          .where(and(eq(approvals.runId, run.runId), eq(approvals.nodeId, 'ask'))),
      )
    )[0]?.n;

  function activities(mailer: Mailer, maxRecipients = 20) {
    return createApprovalActivities({
      withContext: database.withContext,
      logger,
      mailer,
      maxRecipients,
      appBaseUrl: 'http://localhost:5173',
    });
  }

  const inputOf = (run: SeededRun) => ({
    organizationId: run.organizationId,
    runId: run.runId,
    nodeId: 'ask',
    correlationId: randomUUID(),
    message: SECRET_MESSAGE,
  });

  it('emails the owners and editors who can decide, not the initiator nor viewers', async () => {
    const run = await seedRun(pool, EMPTY);
    const editor = await addMember(run, 'editor', 'editor');
    const owner = await addMember(run, 'owner', 'owner2');
    await addMember(run, 'viewer', 'viewer');
    await pending(run);
    const mailer = recordingMailer();
    const result = await activities(mailer).notifyApprovers(inputOf(run));
    expect(result).toEqual({ notified: 2 });
    expect(mailer.sent.map((mail) => mail.to).sort()).toEqual([editor.email, owner.email].sort());
    expect(await notifiedCount(run)).toBe(2);
  });

  it('never carries the message of the approval, only the metadata and a link', async () => {
    const run = await seedRun(pool, EMPTY);
    await addMember(run, 'editor', 'editor');
    await pending(run);
    const mailer = recordingMailer();
    await activities(mailer).notifyApprovers(inputOf(run));
    const mail = mailer.sent[0]!;
    for (const part of [mail.subject, mail.text, mail.html]) {
      expect(part).not.toContain('4411');
      expect(part).not.toContain('Ana');
    }
    expect(mail.subject).toMatch(/^Aprobación pendiente en /);
    expect(mail.text).toContain('Aprobar pedido');
    expect(mail.text).toContain(`/orgs/${run.organizationId}/approvals`);
  });

  it('limits the recipients to the configured maximum (20 at most)', async () => {
    const base = await seedRun(pool, EMPTY);
    for (let i = 0; i < 24; i++) await addMember(base, 'editor', `e${i}`);
    const run = await webhookRun(base);
    await pending(run, null);
    const mailer = recordingMailer();
    const result = await activities(mailer, 20).notifyApprovers(inputOf(run));
    expect(result.notified).toBe(20);
    expect(mailer.sent).toHaveLength(20);
    expect(await notifiedCount(run)).toBe(20);
  });

  it('includes the owner when a webhook or a schedule started the run (nobody is excluded)', async () => {
    const run = await webhookRun(await seedRun(pool, EMPTY));
    await pending(run, null);
    const mailer = recordingMailer();
    expect((await activities(mailer).notifyApprovers(inputOf(run))).notified).toBe(1);
  });

  it('does not notify twice, nor a request that is no longer pending', async () => {
    const run = await seedRun(pool, EMPTY);
    await addMember(run, 'editor', 'editor');
    await pending(run);
    const mailer = recordingMailer();
    const approver = activities(mailer);
    await approver.notifyApprovers(inputOf(run));
    expect(await approver.notifyApprovers(inputOf(run))).toEqual({ notified: 0 });
    expect(mailer.sent).toHaveLength(1);
    expect(
      await activities(recordingMailer()).notifyApprovers(inputOf(await seedRun(pool, EMPTY))),
    ).toEqual({
      notified: 0,
    });
  });

  it('throws when SMTP fails so Temporal retries, and leaves notified_count at 0', async () => {
    const run = await seedRun(pool, EMPTY);
    await addMember(run, 'editor', 'editor');
    await pending(run);
    await expect(
      activities(recordingMailer({ fail: true })).notifyApprovers(inputOf(run)),
    ).rejects.toThrow();
    expect(await notifiedCount(run)).toBe(0);
  });

  it('the template escapes the names it embeds', () => {
    const mail = approvalRequestedEmail({
      workflowName: '<script>alert(1)</script>',
      nodeLabel: 'a & b',
      expiresAt: new Date('2026-11-07T10:00:00Z'),
      url: 'http://localhost/x?a=1&b=2',
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.text).toContain('2026-11-07 10:00:00 UTC');
  });
});

describe('a failing notification never affects the run', () => {
  let env: TestWorkflowEnvironment;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createLocal();
  }, 120_000);

  afterAll(async () => {
    await env?.teardown();
  });

  it('the run still waits, is decided and succeeds when notifyApprovers keeps failing', async () => {
    const dag = definition(
      [
        trigger(),
        node('ask', 'human.approval', { message: 'ok', timeoutSeconds: 3600 }),
        mock('go'),
      ],
      [edge('trigger', 'ask'), edge('ask', 'go', 'approved')],
    );
    const run = await runEngine(env, {
      dag,
      activities: {
        notifyApprovers: () => Promise.reject(new Error('SMTP down')),
      },
      during: async (current) => {
        await waitFor(() => eventsOf(current, 'approval.requested').length > 0);
        await current.handle.executeUpdate('decideApproval', {
          args: [{ nodeId: 'ask', decision: 'approved', decidedBy: randomUUID() }],
        });
      },
    });
    expect(eventsOf(run, 'run.finished')[0]).toMatchObject({ status: 'succeeded' });
  }, 120_000);
});
