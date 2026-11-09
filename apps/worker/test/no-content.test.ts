import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import Valkey from 'iovalkey';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXECUTE_DAG_WORKFLOW_NAME, type ExecuteDagInput } from '@cognitive-dag/contracts';
import { createDatabase, type DatabaseClient } from '@cognitive-dag/db';
import { createLogger } from '@cognitive-dag/logger';
import type { ApprovalMail, Mailer } from '../src/approvals/mail';
import { parseEnv } from '../src/config/env.schema';
import { loadLocalEnv } from '../src/config/load-env';
import { createHttpWorker, createWorker } from '../src/worker';
import { definition, edge, mock, node } from './helpers/dags';
import { seedRun } from './integration/support/seed';
import { MASTER_KEY, insertCredential, startLocalServer, type LocalServer } from './support/f7';

loadLocalEnv();
const config = parseEnv(process.env);

// SC-003 and SC-007: the body of the webhook, the response of an HTTP call, a secret, the message
// and the comment of an approval live only in the Temporal history. Not in the logs, the events, the
// live messages, the emails nor the rows of PostgreSQL.
const CANARIES = {
  webhookBody: 'HOOKBODY-CANARY-4417',
  requestBody: 'REQBODY-CANARY-4417',
  responseBody: 'RESPONSE-CANARY-4417',
  urlPath: 'URLPATH-CANARY-4417',
  secret: 'SECRET-CANARY-4417',
  message: 'MESSAGE-CANARY-4417',
  comment: 'COMMENT-CANARY-4417',
};

describe('no content in logs, events or tables (requires docker compose up)', () => {
  let env: TestWorkflowEnvironment;
  let database: DatabaseClient;
  let pool: pg.Pool;
  let valkey: Valkey;
  let server: LocalServer;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createLocal();
    database = createDatabase({ connectionString: config.DATABASE_URL, max: 4 });
    pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
    valkey = new Valkey(config.VALKEY_URL);
    server = await startLocalServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(CANARIES.responseBody);
    });
  }, 120_000);

  afterAll(async () => {
    await server.close();
    valkey.disconnect();
    await pool.end();
    await database.end();
    await env?.teardown();
  });

  let currentRunId = '';
  let currentOrganizationId = '';
  async function approvalIsPending(): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.organization_id', $1, true)", [
        currentOrganizationId,
      ]);
      const { rowCount } = await client.query(
        "SELECT 1 FROM approvals WHERE run_id = $1 AND status = 'pending'",
        [currentRunId],
      );
      await client.query('COMMIT');
      return (rowCount ?? 0) > 0;
    } finally {
      client.release();
    }
  }

  async function dumpRows(organizationId: string): Promise<string> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
      const out: Record<string, unknown[]> = {};
      for (const table of [
        'workflow_runs',
        'workflow_run_steps',
        'approvals',
        'node_effects',
        'credentials',
        'workflow_schedules',
        'webhook_triggers',
      ]) {
        const { rows } = await client.query(`SELECT * FROM ${table}`);
        out[table] = rows;
      }
      await client.query('COMMIT');
      return JSON.stringify(out, (_key, value: unknown) =>
        Buffer.isBuffer(value) ? value.toString('hex') : value,
      );
    } finally {
      client.release();
    }
  }

  it('leaves none of the sensitive content outside Temporal', async () => {
    const run = await seedRun(pool, { schemaVersion: 1, nodes: [], edges: [] });
    currentRunId = run.runId;
    currentOrganizationId = run.organizationId;
    const editor = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.organization_id', $1, true)", [
        run.organizationId,
      ]);
      await client.query(
        'INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)',
        [editor, `ed-${editor}@example.test`, 'editor', '$argon2id$test'],
      );
      await client.query(
        "INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'editor')",
        [run.organizationId, editor],
      );
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const credentialId = await insertCredential(database.withContext, {
      organizationId: run.organizationId,
      userId: run.userId,
      secret: CANARIES.secret,
    });

    const logs: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        logs.push(chunk.toString('utf8'));
        callback();
      },
    });
    const logger = createLogger({ component: 'worker-test', level: 'trace' }, sink);
    const published: string[] = [];
    const sent: ApprovalMail[] = [];
    const mailer: Mailer = {
      send: (mail) => {
        sent.push(mail);
        return Promise.resolve();
      },
      close: () => undefined,
    };
    const taskQueue = `main-${randomUUID()}`;
    const httpQueue = `http-${randomUUID()}`;

    const publish = (_channel: string, message: string) => {
      published.push(message);
      return Promise.resolve(1);
    };
    const main = await createWorker({
      connection: env.nativeConnection,
      namespace: 'default',
      taskQueue,
      workerId: 'worker-test',
      activityDelayMs: 0,
      nodeEnv: 'test',
      logger,
      runs: { withContext: database.withContext, publish, valkey },
      triggers: {
        triggersOn: true,
        llmEnabled: false,
        llmTaskQueue: 'unused',
        httpTaskQueue: httpQueue,
        mailer,
        approvalMaxRecipients: 20,
        appBaseUrl: 'http://localhost:5173',
      },
    });
    const http = await createHttpWorker({
      connection: env.nativeConnection,
      namespace: 'default',
      taskQueue: httpQueue,
      logger,
      withContext: database.withContext,
      valkey,
      enabled: true,
      masterKey: MASTER_KEY,
      breaker: { failures: 5, windowSeconds: 60, cooldownSeconds: 30, maxWaitSeconds: 120 },
      maxConcurrentActivities: 5,
      allowLoopback: true,
      tls: { ca: server.ca },
    });

    const dag = definition(
      [
        node('hook', 'trigger.webhook', { bodySchema: [] }),
        node('call', 'http.request', {
          method: 'POST',
          url: server.url(`/${CANARIES.urlPath}`),
          headers: {},
          body: CANARIES.requestBody,
          credentialId,
        }),
        node('ask', 'human.approval', { message: CANARIES.message, timeoutSeconds: 3600 }),
        mock('done'),
      ],
      [edge('hook', 'call'), edge('call', 'ask'), edge('ask', 'done', 'approved')],
    );
    const input: ExecuteDagInput = {
      organizationId: run.organizationId,
      workflowId: run.workflowId,
      versionId: run.versionId,
      versionNumber: 1,
      runId: run.runId,
      correlationId: randomUUID(),
      definition: dag,
      triggerInput: { note: CANARIES.webhookBody },
      executablePhases: ['F3', 'F7'],
      httpTaskQueue: httpQueue,
      triggerKind: 'webhook',
    };

    const result = await main.runUntil(() =>
      http.runUntil(async () => {
        const handle = await env.client.workflow.start(EXECUTE_DAG_WORKFLOW_NAME, {
          taskQueue,
          workflowId: `run-${run.runId}`,
          args: [input],
        });
        // Wait until the run is parked on the approval, then decide with a comment.
        for (let i = 0; i < 300 && !(await approvalIsPending()); i++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        await handle.executeUpdate('decideApproval', {
          args: [
            { nodeId: 'ask', decision: 'approved', decidedBy: editor, comment: CANARIES.comment },
          ],
        });
        const outcome: unknown = await handle.result();
        return outcome;
      }),
    );

    // Control: the content does exist where it is allowed to, in the Temporal history.
    const json = JSON.stringify(result);
    expect(json).toContain(CANARIES.webhookBody);
    expect(json).toContain(CANARIES.responseBody);
    // The payloads of the history are base64 of their JSON: decode them to look inside.
    const history = JSON.stringify(
      (await env.client.workflow.getHandle(`run-${run.runId}`).fetchHistory()).events,
    ).replace(/"data":"([A-Za-z0-9+/=]+)"/g, (_match, data: string) =>
      Buffer.from(data, 'base64').toString('utf8'),
    );
    expect(history).toContain(CANARIES.message);
    expect(history).toContain(CANARIES.comment);
    expect(history).toContain(CANARIES.requestBody);

    const everywhereElse = {
      logs: logs.join(''),
      rows: await dumpRows(run.organizationId),
      live: published.join('\n'),
      mail: JSON.stringify(sent),
    };
    expect(everywhereElse.logs.length).toBeGreaterThan(0);
    expect(everywhereElse.rows).toContain('"status":"approved"');
    expect(sent.length).toBeGreaterThan(0);
    for (const [where, text] of Object.entries(everywhereElse)) {
      for (const [name, canary] of Object.entries(CANARIES)) {
        expect(text, `${name} leaked into ${where}`).not.toContain(canary);
      }
    }
  }, 120_000);
});
