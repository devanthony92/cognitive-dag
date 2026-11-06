import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import type { TestWorkflowEnvironment } from '@temporalio/testing';
import Valkey from 'iovalkey';
import pg from 'pg';
import {
  COMPILE_INTENT_WORKFLOW_NAME,
  type CompileIntentInput,
  type CompileIntentResult,
} from '@cognitive-dag/contracts';
import { createDatabase, type DatabaseClient } from '@cognitive-dag/db';
import { FakeProvider, type FakeStep, type LlmProvider } from '@cognitive-dag/llm';
import { createLogger } from '@cognitive-dag/logger';
import { parseEnv } from '../../src/config/env.schema';
import { loadLocalEnv } from '../../src/config/load-env';
import { createLlmWorker, createWorker, createWorkerId } from '../../src/worker';

loadLocalEnv();
export const config = parseEnv(process.env);

export const COMPILER_MODEL = 'test-compiler';

export const F5_TYPES = [
  'trigger.manual',
  'logic.condition',
  'logic.merge',
  'mock.service',
  'llm.classify',
  'llm.extract',
  'llm.generate',
];

/** Manual trigger -> classify -> condition -> mock service on each branch (valid, 5 nodes). */
export function validDag(title = 'Clasificar correos') {
  return {
    title,
    nodes: [
      {
        id: 'start',
        type: 'trigger.manual',
        label: 'Inicio',
        config: { inputSchema: [{ name: 'body', type: { kind: 'string' } }] },
      },
      {
        id: 'classify',
        type: 'llm.classify',
        label: 'Clasificar',
        config: { text: '{{nodes.start.output.body}}', labels: ['spam', 'ham'] },
      },
      {
        id: 'is_spam',
        type: 'logic.condition',
        label: '¿Es spam?',
        config: {
          condition: {
            op: 'eq',
            left: { kind: 'ref', path: 'nodes.classify.output.label' },
            right: { kind: 'literal', type: 'string', value: 'spam' },
          },
        },
      },
      {
        id: 'archive',
        type: 'mock.service',
        label: 'Archivar',
        config: { latencyMs: 100, failureRate: 0, failureKind: 'transient' },
      },
      {
        id: 'reply',
        type: 'mock.service',
        label: 'Responder',
        config: { latencyMs: 100, failureRate: 0, failureKind: 'transient' },
      },
    ],
    edges: [
      { from: 'start', fromHandle: 'out', to: 'classify' },
      { from: 'classify', fromHandle: 'out', to: 'is_spam' },
      { from: 'is_spam', fromHandle: 'true', to: 'archive' },
      { from: 'is_spam', fromHandle: 'false', to: 'reply' },
    ],
  };
}

/** The same DAG with a connection back to `classify`: a cycle the repairs may not fix. */
export function cyclicDag() {
  const dag = validDag();
  return { ...dag, edges: [...dag.edges, { from: 'reply', fromHandle: 'out', to: 'classify' }] };
}

export const answer = (value: unknown, usage: Partial<FakeStep> = {}): FakeStep => ({
  text: JSON.stringify(value),
  ...usage,
});

export interface Seeded {
  organizationId: string;
  userId: string;
  compilationId: string;
  workflowId: string | null;
  correlationId: string;
}

async function inTransaction<T>(
  pool: pg.Pool,
  settings: Record<string, string>,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [name, value] of Object.entries(settings)) {
      await client.query('SELECT set_config($1, $2, true)', [name, value]);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * What registration and the API's POST do, as `app_runtime`: a user, its organization and a
 * `queued` compilation (with a workflow in mode `regenerate`).
 */
export async function seedCompilation(
  pool: pg.Pool,
  options: { mode?: 'create' | 'regenerate'; intentChars?: number } = {},
): Promise<Seeded> {
  const userId = randomUUID();
  const organizationId = randomUUID();
  const compilationId = randomUUID();
  const correlationId = randomUUID();
  const regenerate = options.mode === 'regenerate';
  const workflowId = regenerate ? randomUUID() : null;
  await inTransaction(
    pool,
    { 'app.user_id': userId, 'app.organization_id': organizationId },
    async (client) => {
      await client.query(
        'INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)',
        [userId, `compiler-${userId}@example.test`, 'compiler test', '$argon2id$test'],
      );
      await client.query(
        'INSERT INTO organizations (id, name, is_personal, created_by) VALUES ($1, $2, true, $3)',
        [organizationId, `Personal ${userId.slice(0, 8)}`, userId],
      );
      await client.query(
        "INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')",
        [organizationId, userId],
      );
      if (workflowId) {
        await client.query(
          `INSERT INTO workflows (id, organization_id, name, draft_updated_by, created_by)
           VALUES ($1, $2, 'Flujo existente', $3, $3)`,
          [workflowId, organizationId, userId],
        );
      }
      await client.query(
        `INSERT INTO compilations
           (id, organization_id, workflow_id, requested_by, mode, base_draft_revision, intent_chars,
            model, correlation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          compilationId,
          organizationId,
          workflowId,
          userId,
          regenerate ? 'regenerate' : 'create',
          regenerate ? 1 : null,
          options.intentChars ?? 80,
          COMPILER_MODEL,
          correlationId,
        ],
      );
    },
  );
  return { organizationId, userId, compilationId, workflowId, correlationId };
}

export interface CompilationRow {
  status: string;
  calls: number;
  repairs: number;
  llm_tokens_used: number;
  cost_micro_usd: string;
  node_count: number | null;
  has_fallback: boolean;
  error_class: string | null;
  error_code: string | null;
  started_at: Date | null;
  finished_at: Date | null;
}

export interface LlmCallRow {
  node_type: string;
  run_id: string | null;
  node_id: string | null;
  compilation_id: string | null;
  attempt: number;
  repairs: number;
  model: string;
  reserved_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cost_micro_usd: string;
  outcome: string;
  error_code: string | null;
}

export async function readState(pool: pg.Pool, seed: Seeded) {
  return inTransaction(pool, { 'app.organization_id': seed.organizationId }, async (client) => {
    const compilations = await client.query<CompilationRow>(
      'SELECT * FROM compilations WHERE id = $1',
      [seed.compilationId],
    );
    const calls = await client.query<LlmCallRow>(
      'SELECT * FROM llm_calls WHERE compilation_id = $1 ORDER BY repairs, created_at',
      [seed.compilationId],
    );
    const day = await client.query<{ tokens_used: string; cost_micro_usd: string }>(
      'SELECT tokens_used, cost_micro_usd FROM llm_usage_daily WHERE organization_id = $1',
      [seed.organizationId],
    );
    return { compilation: compilations.rows[0], calls: calls.rows, day: day.rows[0] };
  });
}

export function compileInput(seed: Seeded, overrides: Partial<CompileIntentInput>) {
  const input: CompileIntentInput = {
    compilationId: seed.compilationId,
    organizationId: seed.organizationId,
    correlationId: seed.correlationId,
    intent: 'Clasifica cada correo como spam o no y responde los que no lo son.',
    allowedTypes: F5_TYPES,
    llmTaskQueue: '',
    ...overrides,
  };
  return input;
}

export interface HarnessOptions {
  provider: LlmProvider | readonly FakeStep[] | undefined;
  enabled?: boolean;
  perCompilation?: number;
  perOrganizationDay?: number;
}

/** Temporal test server, both workers and PostgreSQL: what one test of the compiler needs. */
export class CompilerHarness {
  readonly logs: string[] = [];
  database!: DatabaseClient;
  pool!: pg.Pool;
  valkey!: Valkey;

  constructor(readonly env: TestWorkflowEnvironment) {}

  start(): void {
    this.database = createDatabase({ connectionString: config.DATABASE_URL, max: 6 });
    this.pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
    this.valkey = new Valkey(config.VALKEY_URL);
  }

  async stop(): Promise<void> {
    this.valkey.disconnect();
    await this.pool.end();
    await this.database.end();
  }

  /** Runs `compileIntent` end to end on a fresh pair of task queues. */
  async compile(
    seed: Seeded,
    options: HarnessOptions,
    inputOverrides: Partial<CompileIntentInput> = {},
  ): Promise<{ result: CompileIntentResult | undefined; provider: LlmProvider; error?: unknown }> {
    const sink = new Writable({
      write: (chunk: Buffer, _encoding, done) => {
        this.logs.push(chunk.toString());
        done();
      },
    });
    const logger = createLogger({ component: 'worker-test', level: 'trace' }, sink);
    const provider =
      options.provider && 'generate' in options.provider
        ? options.provider
        : new FakeProvider(options.provider);
    const mainQueue = `test-${randomUUID()}`;
    const llmQueue = `test-llm-${randomUUID()}`;
    const worker = await createWorker({
      connection: this.env.nativeConnection,
      namespace: 'default',
      taskQueue: mainQueue,
      workerId: createWorkerId(),
      activityDelayMs: 0,
      nodeEnv: 'test',
      logger,
    });
    const llmWorker = await createLlmWorker({
      connection: this.env.nativeConnection,
      namespace: 'default',
      taskQueue: llmQueue,
      logger,
      provider,
      withContext: this.database.withContext,
      valkey: this.valkey,
      limits: { perRun: 50_000, perOrganizationDay: options.perOrganizationDay ?? 500_000 },
      enabled: options.enabled ?? true,
      models: {
        'llm.classify': 'test-lite',
        'llm.extract': 'test-lite',
        'llm.generate': 'test-lite',
      },
      prices: new Map([[COMPILER_MODEL, { input: 100_000, output: 400_000 }]]),
      maxInputChars: 10_000,
      maxConcurrentActivities: 2,
      compiler: {
        model: COMPILER_MODEL,
        maxTokensPerCompilation: options.perCompilation ?? 30_000,
      },
    });
    const input = compileInput(seed, { llmTaskQueue: llmQueue, ...inputOverrides });
    let result: CompileIntentResult | undefined;
    let error: unknown;
    await llmWorker.runUntil(() =>
      worker.runUntil(async () => {
        const handle = await this.env.client.workflow.start(COMPILE_INTENT_WORKFLOW_NAME, {
          taskQueue: mainQueue,
          workflowId: `compile-${seed.compilationId}`,
          args: [input],
        });
        try {
          result = (await handle.result()) as CompileIntentResult;
        } catch (cause) {
          error = cause;
        }
      }),
    );
    return { result, provider, ...(error === undefined ? {} : { error }) };
  }
}
