import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import { Client, Connection, type WorkflowHandle } from '@temporalio/client';
import { NativeConnection } from '@temporalio/worker';
import Valkey from 'iovalkey';
import pg from 'pg';
import { expect } from 'vitest';
import { createDatabase, type DatabaseClient } from '@cognitive-dag/db';
import {
  EXECUTE_DAG_WORKFLOW_NAME,
  RUN_EXECUTION_TIMEOUT,
  type ExecuteDagInput,
  type ExecuteDagResult,
} from '@cognitive-dag/contracts';
import { parseEnv, type WorkerConfig } from '../../../src/config/env.schema';
import { loadLocalEnv } from '../../../src/config/load-env';
import { createWorker } from '../../../src/worker';
import { readRun, seedRun, type SeededRun } from '../../integration/support/seed';

const docker = promisify(execFile);

/** Only the Compose containers of this project may be touched by a chaos test. */
const CONTAINER_PREFIX = 'cognitive-dag-';

export type Service = 'temporal' | 'valkey' | 'postgres';

export type RunHandle = WorkflowHandle<(i: ExecuteDagInput) => Promise<ExecuteDagResult>>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function containerOf(service: Service): Promise<string> {
  const { stdout } = await docker('docker', [
    'ps',
    '--all',
    '--filter',
    'label=com.docker.compose.project=cognitive-dag',
    '--filter',
    `label=com.docker.compose.service=${service}`,
    '--format',
    '{{.Names}}',
  ]);
  const name = stdout.trim().split(/\r?\n/)[0] ?? '';
  if (!name.startsWith(CONTAINER_PREFIX)) {
    throw new Error(`The ${service} container of the cognitive-dag project was not found`);
  }
  return name;
}

/** Pauses a Compose container for `ms`, and resumes it even if something fails meanwhile. */
export async function pauseFor(service: Service, ms: number): Promise<void> {
  const name = await containerOf(service);
  await docker('docker', ['pause', name]);
  try {
    await sleep(ms);
  } finally {
    await docker('docker', ['unpause', name]);
  }
}

/** Restarts a Compose container and waits for it to be healthy again. */
export async function restart(service: Service): Promise<void> {
  const name = await containerOf(service);
  await docker('docker', ['restart', '--time', '1', name]);
  await ensureRunning(service);
}

/** Leaves the container running and healthy: the `finally` of every chaos test. */
export async function ensureRunning(service: Service): Promise<void> {
  const name = await containerOf(service);
  const deadline = Date.now() + 90_000;
  for (;;) {
    const { stdout } = await docker('docker', [
      'inspect',
      '--format',
      '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}',
      name,
    ]);
    const [state = '', health = ''] = stdout.trim().split(' ');
    if (state === 'paused') await docker('docker', ['unpause', name]);
    else if (state !== 'running') await docker('docker', ['start', name]);
    else if (health === '' || health === 'healthy') return;
    if (Date.now() > deadline) throw new Error(`${name} did not become healthy`);
    await sleep(1_000);
  }
}

export interface Harness {
  config: WorkerConfig;
  client: Client;
  native: NativeConnection;
  database: DatabaseClient;
  pool: pg.Pool;
  valkey: Valkey;
  close(): Promise<void>;
}

/** Connections of a chaos test; Valkey times out fast so a paused one fails instead of hanging. */
export async function openHarness(): Promise<Harness> {
  loadLocalEnv();
  const config = parseEnv(process.env);
  const connection = await Connection.connect({ address: config.TEMPORAL_ADDRESS });
  const native = await NativeConnection.connect({ address: config.TEMPORAL_ADDRESS });
  const client = new Client({ connection, namespace: config.TEMPORAL_NAMESPACE });
  const database = createDatabase({ connectionString: config.DATABASE_URL, max: 4 });
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
  pool.on('error', () => undefined);
  const valkey = new Valkey(config.VALKEY_URL, {
    connectTimeout: 2_000,
    commandTimeout: 2_000,
    maxRetriesPerRequest: 1,
  });
  valkey.on('error', () => undefined);
  return {
    config,
    client,
    native,
    database,
    pool,
    valkey,
    async close() {
      valkey.disconnect();
      await pool.end();
      await database.end();
      await native.close();
      await connection.close();
    },
  };
}

export async function startRun(
  h: Harness,
  taskQueue: string,
  dag: Record<string, unknown>,
): Promise<{ seeded: SeededRun; handle: RunHandle }> {
  const seeded = await seedRun(h.pool, dag);
  const input: ExecuteDagInput = {
    organizationId: seeded.organizationId,
    workflowId: seeded.workflowId,
    versionId: seeded.versionId,
    versionNumber: 1,
    runId: seeded.runId,
    correlationId: randomUUID(),
    definition: dag,
    triggerInput: { amount: 150, tone: 'happy' },
  };
  const handle = await h.client.workflow.start<(i: ExecuteDagInput) => Promise<ExecuteDagResult>>(
    EXECUTE_DAG_WORKFLOW_NAME,
    {
      taskQueue,
      workflowId: `run-${input.runId}`,
      args: [input],
      workflowExecutionTimeout: RUN_EXECUTION_TIMEOUT,
    },
  );
  return { seeded, handle };
}

/** A worker in this process: the one that survives the fault or takes over after a kill. */
export async function startWorker(
  h: Harness,
  taskQueue: string,
  workerId: string,
): Promise<{ stop(): Promise<void> }> {
  const worker = await createWorker({
    connection: h.native,
    namespace: h.config.TEMPORAL_NAMESPACE,
    taskQueue,
    workerId,
    activityDelayMs: 0,
    nodeEnv: 'test',
    shutdownGraceTime: '100ms',
    runs: {
      withContext: h.database.withContext,
      publish: (channel, message) => h.valkey.publish(channel, message),
      valkey: h.valkey,
    },
  });
  const running = worker.run();
  return {
    async stop() {
      worker.shutdown();
      await running;
    },
  };
}

/** Spawns the worker in its own process so it can be killed without any cleanup. */
export function spawnWorker(
  h: Harness,
  taskQueue: string,
  workerId: string,
): { kill(): Promise<void> } {
  const child: ChildProcess = spawn(
    process.execPath,
    ['--import', 'tsx', path.resolve(__dirname, '../fixtures/crash-run-worker.ts')],
    {
      cwd: path.resolve(__dirname, '../../..'),
      stdio: 'ignore',
      env: {
        ...process.env,
        TEMPORAL_ADDRESS: h.config.TEMPORAL_ADDRESS,
        TEMPORAL_NAMESPACE: h.config.TEMPORAL_NAMESPACE,
        TASK_QUEUE: taskQueue,
        WORKER_ID: workerId,
      },
    },
  );
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  return {
    async kill() {
      child.kill('SIGKILL');
      await exited;
    },
  };
}

/** Polls until `check` holds; errors while a service is down count as "not yet". */
export async function waitUntil(
  check: () => Promise<boolean>,
  what: string,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ok = await check().catch(() => false);
    if (ok) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(150);
  }
}

export async function stepStatus(
  h: Harness,
  seeded: SeededRun,
  nodeId: string,
): Promise<string | undefined> {
  return (await readRun(h.pool, seeded)).steps.find((s) => s.node_id === nodeId)?.status;
}

/** Waits for the result while the infrastructure may be down: client errors are retried. */
export async function resultOf(handle: RunHandle, timeoutMs = 120_000): Promise<ExecuteDagResult> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await handle.result();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      const described = await handle.describe().catch(() => undefined);
      if (described && described.status.name !== 'RUNNING') throw error;
      await sleep(500);
    }
  }
}

interface EffectRow {
  node_id: string;
  status: string;
}

/**
 * The invariant of every chaos test: the run succeeded, each node with an effect has a single
 * `committed` row in `node_effects`, and the simulated destination holds a single record for each.
 */
export async function expectNoRepeatedEffects(
  h: Harness,
  seeded: SeededRun,
  nodeIds: string[],
): Promise<void> {
  const state = await readRun(h.pool, seeded);
  expect(state.run?.status).toBe('succeeded');
  for (const id of nodeIds) {
    expect(state.steps.find((s) => s.node_id === id)?.status, id).toBe('succeeded');
  }

  const client = await h.pool.connect();
  let rows: EffectRow[];
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', [
      'app.organization_id',
      seeded.organizationId,
    ]);
    ({ rows } = await client.query<EffectRow>(
      'SELECT node_id, status FROM node_effects WHERE run_id = $1 ORDER BY node_id',
      [seeded.runId],
    ));
    await client.query('COMMIT');
  } finally {
    client.release();
  }
  expect(rows.map((r) => r.node_id)).toEqual([...nodeIds].sort());
  for (const row of rows) expect(row.status, row.node_id).toBe('committed');

  const records = await h.valkey.keys(`mock:effect:${seeded.runId}:*`);
  expect(records.sort()).toEqual(nodeIds.map((id) => `mock:effect:${seeded.runId}:${id}`).sort());
}
