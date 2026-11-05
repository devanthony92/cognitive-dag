import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import Valkey from 'iovalkey';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXECUTE_DAG_WORKFLOW_NAME, type ExecuteDagInput } from '@cognitive-dag/contracts';
import { createDatabase, type DatabaseClient } from '@cognitive-dag/db';
import { FakeProvider, type FakeStep } from '@cognitive-dag/llm';
import { createLogger } from '@cognitive-dag/logger';
import { parseEnv } from '../../src/config/env.schema';
import { loadLocalEnv } from '../../src/config/load-env';
import { createLlmWorker, createWorker, createWorkerId } from '../../src/worker';
import { classifyNode, definition, edge, generateNode, trigger } from '../helpers/dags';
import { MODELS } from '../helpers/llm';
import { seedRun } from './support/seed';

loadLocalEnv();
const config = parseEnv(process.env);

/** Text marked so any copy of it is found (SC-004). */
const MARKER = 'ZEBRA-7731-NO-LOG';
const LLM_QUEUE = 'test-llm-no-content';

describe('no content in logs, events or tables (SC-004; requires docker compose up)', () => {
  let env: TestWorkflowEnvironment;
  let database: DatabaseClient;
  let pool: pg.Pool;
  let valkey: Valkey;

  beforeAll(async () => {
    env = await TestWorkflowEnvironment.createLocal();
    database = createDatabase({ connectionString: config.DATABASE_URL, max: 4 });
    pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
    valkey = new Valkey(config.VALKEY_URL);
  }, 120_000);

  afterAll(async () => {
    valkey?.disconnect();
    await pool?.end();
    await database?.end();
    await env?.teardown();
  });

  /** Runs a whole workflow on the two workers and returns everything it left behind. */
  async function leftovers(script: readonly FakeStep[] | undefined, nodes: unknown[]) {
    const dag = definition(
      [trigger(), ...(nodes as ReturnType<typeof classifyNode>[])],
      [edge('trigger', 'c'), edge('c', 'g')],
    );
    const run = await seedRun(pool, dag);
    const logs: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        logs.push(chunk.toString());
        done();
      },
    });
    const logger = createLogger({ component: 'worker-test', level: 'trace' }, sink);
    const published: string[] = [];
    const mainQueue = `test-${randomUUID()}`;

    const worker = await createWorker({
      connection: env.nativeConnection,
      namespace: 'default',
      taskQueue: mainQueue,
      workerId: createWorkerId(),
      activityDelayMs: 0,
      nodeEnv: 'test',
      logger,
      runs: {
        withContext: database.withContext,
        publish: (_channel, message) => {
          published.push(message);
          return Promise.resolve();
        },
        valkey,
      },
    });
    const llmWorker = await createLlmWorker({
      connection: env.nativeConnection,
      namespace: 'default',
      taskQueue: LLM_QUEUE,
      logger,
      provider: new FakeProvider(script),
      withContext: database.withContext,
      valkey,
      limits: { perRun: 50_000, perOrganizationDay: 500_000 },
      enabled: true,
      models: MODELS,
      prices: new Map(),
      maxInputChars: 10_000,
      maxConcurrentActivities: 2,
    });

    const input: ExecuteDagInput = {
      organizationId: run.organizationId,
      workflowId: run.workflowId,
      versionId: run.versionId,
      versionNumber: 1,
      runId: run.runId,
      correlationId: randomUUID(),
      definition: dag,
      triggerInput: { amount: 1, tone: 'x' },
      llmTaskQueue: LLM_QUEUE,
      executablePhases: ['F3', 'F5'],
    };
    await llmWorker.runUntil(() =>
      worker.runUntil(async () => {
        const handle = await env.client.workflow.start(EXECUTE_DAG_WORKFLOW_NAME, {
          taskQueue: mainQueue,
          workflowId: `run-${run.runId}`,
          args: [input],
        });
        await handle.result().catch(() => undefined);
      }),
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.organization_id', $1, true)", [
        run.organizationId,
      ]);
      const rows = {
        runs: (await client.query('SELECT * FROM workflow_runs WHERE id = $1', [run.runId])).rows,
        steps: (
          await client.query('SELECT * FROM workflow_run_steps WHERE run_id = $1', [run.runId])
        ).rows,
        calls: (await client.query('SELECT * FROM llm_calls WHERE run_id = $1', [run.runId])).rows,
      };
      await client.query('COMMIT');
      return { logs: logs.join(''), published: published.join(''), rows };
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  it('leaves no trace of the text after a complete run', async () => {
    const left = await leftovers(undefined, [
      classifyNode('c', `Customer says ${MARKER}`),
      generateNode('g', `Reply about ${MARKER}`),
    ]);
    const steps = left.rows.steps as { status: string }[];
    expect(steps.every((s) => s.status === 'succeeded')).toBe(true);
    expect(left.rows.calls).toHaveLength(2);
    expect(left.logs.length).toBeGreaterThan(0);

    expect(left.logs).not.toContain(MARKER);
    expect(left.published).not.toContain(MARKER);
    expect(JSON.stringify(left.rows)).not.toContain(MARKER);
    // Nor the answer of the model.
    expect(JSON.stringify(left.rows)).not.toContain('texto de ejemplo');
    expect(left.logs).not.toContain('texto de ejemplo');
  }, 60_000);

  it('leaves no trace when the model echoes the text in bad answers and errors', async () => {
    const echo = (text: string): FakeStep => ({ text: JSON.stringify({ label: text }) });
    const left = await leftovers(
      [
        { error: Object.assign(new Error(`provider echoes ${MARKER}`), { status: 503 }) },
        echo(MARKER),
        echo(MARKER),
        echo(MARKER),
      ],
      [classifyNode('c', `Customer says ${MARKER}`), generateNode('g')],
    );
    const calls = left.rows.calls as { outcome: string }[];
    expect(calls.map((c) => c.outcome)).toContain('invalid_output');
    expect(left.logs).not.toContain(MARKER);
    expect(left.published).not.toContain(MARKER);
    expect(JSON.stringify(left.rows)).not.toContain(MARKER);
  }, 60_000);
});
