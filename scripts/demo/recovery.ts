import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client, Connection } from '@temporalio/client';
import { Valkey } from 'iovalkey';
import pg from 'pg';
import {
  EXECUTE_DAG_WORKFLOW_NAME,
  RUN_EXECUTION_TIMEOUT,
  type ExecuteDagInput,
  type ExecuteDagResult,
} from '@cognitive-dag/contracts';

/**
 * Demo of recovery (F4, US7): runs a small workflow, kills the worker while a node is running,
 * starts another one, and shows that the run finishes without repeating any effect.
 *
 *   pnpm demo:recovery
 *
 * It needs the local infrastructure (`docker compose up -d --wait`, `pnpm db:migrate`). It writes
 * a demo organization with one workflow and one run, like any test does, and uses its own task
 * queue, so a worker you already have running does not take part.
 */

const root = resolve(import.meta.dirname, '../..');
const workerDir = resolve(root, 'apps/worker');
const NODES = ['paso_1', 'paso_2', 'paso_3'] as const;

const say = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

function loadRepositoryEnv(): void {
  const file = resolve(root, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable ${name}. ¿Copiaste .env.example a .env?`);
  return value;
}

const node = (id: string, type: string, config: Record<string, unknown>) => ({
  id,
  type,
  label: id,
  position: { x: 0, y: 0 },
  config,
});

const service = (id: string, latencyMs: number) =>
  node(id, 'mock.service', { latencyMs, failureRate: 0, failureKind: 'transient' });

/** trigger -> paso_1 -> paso_2 (lento: el worker cae aquí) -> paso_3 */
const DEMO_DEFINITION = {
  schemaVersion: 1,
  nodes: [
    node('trigger', 'trigger.manual', { inputSchema: [] }),
    service('paso_1', 500),
    service('paso_2', 12_000),
    service('paso_3', 500),
  ],
  edges: [
    { id: 'e1', source: 'trigger', sourceHandle: 'out', target: 'paso_1' },
    { id: 'e2', source: 'paso_1', sourceHandle: 'out', target: 'paso_2' },
    { id: 'e3', source: 'paso_2', sourceHandle: 'out', target: 'paso_3' },
  ],
};

interface DemoRun {
  organizationId: string;
  userId: string;
  workflowId: string;
  versionId: string;
  runId: string;
}

async function inTransaction<T>(
  pool: pg.Pool,
  organizationId: string,
  userId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.user_id', userId]);
    await client.query('SELECT set_config($1, $2, true)', ['app.organization_id', organizationId]);
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

/** The organization, workflow, version and queued run that registration and publication create. */
async function createDemoRun(pool: pg.Pool): Promise<DemoRun> {
  const userId = randomUUID();
  const organizationId = randomUUID();
  const workflowId = randomUUID();
  const versionId = randomUUID();
  const runId = randomUUID();
  const body = JSON.stringify(DEMO_DEFINITION);
  await inTransaction(pool, organizationId, userId, async (client) => {
    await client.query(
      'INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)',
      [userId, `demo-${userId}@example.test`, 'Demo de recuperación', '$argon2id$demo'],
    );
    await client.query(
      'INSERT INTO organizations (id, name, is_personal, created_by) VALUES ($1, $2, true, $3)',
      [organizationId, `Demo ${userId.slice(0, 8)}`, userId],
    );
    await client.query(
      "INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')",
      [organizationId, userId],
    );
    await client.query(
      `INSERT INTO workflows (id, organization_id, name, draft_updated_by, created_by)
       VALUES ($1, $2, 'Demo de recuperación', $3, $3)`,
      [workflowId, organizationId, userId],
    );
    await client.query(
      `INSERT INTO workflow_versions
         (id, organization_id, workflow_id, version_number, definition, definition_hash,
          node_count, edge_count, node_types, published_by)
       VALUES ($1, $2, $3, 1, $4::jsonb, $5, 4, 3, ARRAY['trigger.manual', 'mock.service'], $6)`,
      [
        versionId,
        organizationId,
        workflowId,
        body,
        createHash('sha256').update(body).digest(),
        userId,
      ],
    );
    await client.query(
      `INSERT INTO workflow_runs
         (id, organization_id, workflow_id, version_id, version_number, triggered_by,
          correlation_id, temporal_workflow_id)
       VALUES ($1, $2, $3, $4, 1, $5, $6, $7)`,
      [runId, organizationId, workflowId, versionId, userId, randomUUID(), `run-${runId}`],
    );
  });
  return { organizationId, userId, workflowId, versionId, runId };
}

async function stepStatuses(pool: pg.Pool, run: DemoRun): Promise<Map<string, string>> {
  return inTransaction(pool, run.organizationId, run.userId, async (client) => {
    const { rows } = await client.query<{ node_id: string; status: string }>(
      'SELECT node_id, status FROM workflow_run_steps WHERE run_id = $1',
      [run.runId],
    );
    return new Map(rows.map((row) => [row.node_id, row.status]));
  });
}

async function effectRows(
  pool: pg.Pool,
  run: DemoRun,
): Promise<Array<{ node_id: string; status: string; attempts: number }>> {
  return inTransaction(pool, run.organizationId, run.userId, async (client) => {
    const { rows } = await client.query<{ node_id: string; status: string; attempts: number }>(
      'SELECT node_id, status, attempts FROM node_effects WHERE run_id = $1 ORDER BY node_id',
      [run.runId],
    );
    return rows;
  });
}

function startWorker(taskQueue: string, healthPort: number): ChildProcess {
  return spawn(process.execPath, ['dist/main.js'], {
    cwd: workerDir,
    stdio: 'ignore',
    env: {
      ...process.env,
      TEMPORAL_TASK_QUEUE: taskQueue,
      WORKER_HEALTH_PORT: String(healthPort),
      LOG_LEVEL: 'warn',
    },
  });
}

function kill(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((done) => {
    child.once('exit', () => done());
    child.kill('SIGKILL');
  });
}

async function waitFor(check: () => Promise<boolean>, what: string, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Se agotó el tiempo esperando ${what}.`);
    await sleep(250);
  }
}

async function demo(): Promise<boolean> {
  loadRepositoryEnv();
  if (!existsSync(resolve(workerDir, 'dist/main.js'))) {
    throw new Error('Falta el build del worker. Ejecuta `pnpm demo:recovery` desde la raíz.');
  }
  const taskQueue = `demo-recovery-${randomUUID()}`;
  const pool = new pg.Pool({
    connectionString: required('DATABASE_URL'),
    max: 2,
    connectionTimeoutMillis: 5_000,
  });
  const valkey = new Valkey(required('VALKEY_URL'));
  valkey.on('error', () => undefined);
  const connection = await Connection.connect({ address: required('TEMPORAL_ADDRESS') });
  const client = new Client({
    connection,
    namespace: process.env['TEMPORAL_NAMESPACE'] ?? 'default',
  });
  const workers: ChildProcess[] = [];

  try {
    say('== Demo de recuperación: una ejecución que sobrevive a la caída del worker ==');
    const run = await createDemoRun(pool);
    say(`Workflow de demostración creado (ejecución ${run.runId}).`);
    say('Pasos: paso_1 -> paso_2 (lento, 12 s) -> paso_3. Cada paso tiene un efecto simulado.');

    const first = startWorker(taskQueue, 3101);
    workers.push(first);
    say('Worker 1 iniciado.');
    const handle = await client.workflow.start<
      (input: ExecuteDagInput) => Promise<ExecuteDagResult>
    >(EXECUTE_DAG_WORKFLOW_NAME, {
      taskQueue,
      workflowId: `run-${run.runId}`,
      args: [
        {
          organizationId: run.organizationId,
          workflowId: run.workflowId,
          versionId: run.versionId,
          versionNumber: 1,
          runId: run.runId,
          correlationId: randomUUID(),
          definition: DEMO_DEFINITION,
          triggerInput: {},
        },
      ],
      workflowExecutionTimeout: RUN_EXECUTION_TIMEOUT,
    });
    say('Ejecución iniciada. Esperando a que paso_1 termine y paso_2 esté en curso...');

    await waitFor(
      async () => {
        const steps = await stepStatuses(pool, run);
        return steps.get('paso_1') === 'succeeded' && steps.get('paso_2') === 'running';
      },
      'que paso_2 empezara',
      90_000,
    );
    say('paso_1 terminó y paso_2 está en curso.');
    say('>> Matando el worker 1 (SIGKILL), sin darle oportunidad de limpiar nada.');
    await kill(first);

    const second = startWorker(taskQueue, 3102);
    workers.push(second);
    say('>> Worker 2 iniciado: Temporal le entrega el trabajo pendiente.');

    const result = await handle.result();
    say(`La ejecución terminó con estado "${result.status}".`);

    const steps = await stepStatuses(pool, run);
    for (const id of NODES) say(`  ${id}: ${steps.get(id) ?? 'sin registro'}`);
    const effects = await effectRows(pool, run);
    for (const effect of effects) {
      say(`  efecto ${effect.node_id}: ${effect.status} (intentos: ${effect.attempts})`);
    }
    const records = await valkey.keys(`mock:effect:${run.runId}:*`);
    say(`  registros en el destino simulado: ${records.length}`);

    const ok =
      result.status === 'succeeded' &&
      NODES.every((id) => steps.get(id) === 'succeeded') &&
      effects.length === NODES.length &&
      effects.every((effect) => effect.status === 'committed') &&
      records.length === NODES.length;
    say(
      ok
        ? 'OK: la ejecución terminó sin repetir ningún efecto (un solo "committed" y un solo registro por paso).'
        : 'FALLO: hay efectos repetidos o pasos sin terminar.',
    );
    return ok;
  } finally {
    await Promise.all(workers.map(kill));
    valkey.disconnect();
    await pool.end();
    await connection.close();
  }
}

try {
  process.exitCode = (await demo()) ? 0 : 1;
} catch (error) {
  process.stderr.write(`La demo falló: ${(error as Error).message}\n`);
  process.exitCode = 1;
}
