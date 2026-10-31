import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import Valkey from 'iovalkey';
import { NativeConnection } from '@temporalio/worker';
import request from 'supertest';
import type { Run, RunDetail } from '@cognitive-dag/contracts';
import { createWorker } from '../../../worker/src/worker';
import { startTestApp, testConfig, httpServer } from './helpers';
import { authHeaders, type LoggedIn } from './identity-helpers';
import { uniqueTaskQueue, waitFor, type RunningWorker } from './ping-helpers';
import {
  closeWorkflowsEnv,
  createWorkflow,
  publish,
  saveDraft,
  setupWorkflowsEnv,
  type WorkflowsEnv,
} from './workflows-helpers';

export const RUN_FLAGS =
  '{"ping-enabled":true,"identity-enabled":true,"dag-editor-enabled":true,"execution-enabled":true}';

export interface RunsEnv extends WorkflowsEnv {
  taskQueue: string;
  worker: RunningWorker;
  valkey: Valkey;
}

/** The workflows environment with `execution-enabled` on and a real worker that records runs. */
export async function setupRunsEnv(
  overrides: Parameters<typeof startTestApp>[0] = {},
): Promise<RunsEnv> {
  const taskQueue = uniqueTaskQueue();
  const base = await setupWorkflowsEnv(RUN_FLAGS);
  // setupWorkflowsEnv built its own app on a random queue: replace it with one that shares ours.
  await base.app.close();
  const app = await startTestApp({
    FEATURE_FLAGS: RUN_FLAGS,
    TEMPORAL_TASK_QUEUE: taskQueue,
    ...overrides,
  });
  const valkey = new Valkey(testConfig().VALKEY_URL);
  const worker = await startRunsWorker(taskQueue, base.database, valkey);
  return { ...base, app, taskQueue, worker, valkey };
}

export async function closeRunsEnv(env: RunsEnv): Promise<void> {
  await env.worker.stop();
  env.valkey.disconnect();
  await closeWorkflowsEnv(env);
}

async function startRunsWorker(
  taskQueue: string,
  database: WorkflowsEnv['database'],
  valkey: Valkey,
): Promise<RunningWorker> {
  const config = testConfig();
  const connection = await NativeConnection.connect({ address: config.TEMPORAL_ADDRESS });
  const worker = await createWorker({
    connection,
    namespace: config.TEMPORAL_NAMESPACE,
    taskQueue,
    workerId: `test-${randomUUID()}`,
    activityDelayMs: 0,
    nodeEnv: 'test',
    shutdownGraceTime: '1s',
    runs: {
      withContext: database.withContext,
      publish: (channel, message) => valkey.publish(channel, message),
    },
  });
  const done = worker.run().finally(() => connection.close());
  return {
    worker,
    async stop() {
      worker.shutdown();
      await done;
    },
  };
}

export const runsPath = (organizationId: string, workflowId: string) =>
  `/api/v1/organizations/${organizationId}/workflows/${workflowId}/runs`;
export const runPath = (organizationId: string, runId: string) =>
  `/api/v1/organizations/${organizationId}/runs/${runId}`;

export const api = (env: Pick<WorkflowsEnv, 'app'>) => request(httpServer(env.app));

type NodeSpec = Record<string, unknown>;

const trigger = (inputSchema: unknown[] = []): NodeSpec => ({
  id: 'trigger',
  type: 'trigger.manual',
  label: 'Inicio',
  position: { x: 0, y: 0 },
  config: { inputSchema },
});

const mock = (id: string, latencyMs: number, failureRate = 0): NodeSpec => ({
  id,
  type: 'mock.service',
  label: id,
  position: { x: 200, y: 0 },
  config: { latencyMs, failureRate, failureKind: 'permanent' },
});

const edge = (source: string, target: string): NodeSpec => ({
  id: `${source}_${target}`,
  source,
  sourceHandle: 'out',
  target,
});

/** trigger(monto: number, nota: text) then work. */
export function amountDefinition(latencyMs = 100) {
  return {
    schemaVersion: 1,
    nodes: [
      trigger([
        { name: 'monto', type: { kind: 'number' } },
        { name: 'nota', type: { kind: 'string' } },
      ]),
      mock('work', latencyMs),
    ],
    edges: [edge('trigger', 'work')],
  };
}

/** One slow service, to keep a run in progress. */
export const slowDefinition = (latencyMs = 20_000) => amountDefinition(latencyMs);

/** A version with a node that cannot run until a later phase. */
export function unsupportedDefinition() {
  return {
    schemaVersion: 1,
    nodes: [
      trigger(),
      {
        id: 'texto',
        type: 'llm.generate',
        label: 'Texto',
        position: { x: 200, y: 0 },
        config: { instruction: 'Hola', language: 'es', maxLength: 100 },
      },
    ],
    edges: [edge('trigger', 'texto')],
  };
}

/** Creates a workflow, saves the draft and publishes it as the active version. */
export async function publishedWorkflow(
  env: WorkflowsEnv,
  definition: unknown,
  organizationId = env.organization.id,
  session: LoggedIn = env.owner,
): Promise<string> {
  const workflow = await createWorkflow(env, session, undefined, organizationId);
  const saved = await saveDraft(env, session, workflow.id, 1, definition, organizationId).expect(
    200,
  );
  const revision = (saved.body as { revision: number }).revision;
  await publish(env, session, workflow.id, revision, undefined, organizationId).expect(201);
  return workflow.id;
}

export function startRun(
  env: Pick<WorkflowsEnv, 'app' | 'organization'>,
  session: LoggedIn,
  workflowId: string,
  input: Record<string, unknown> = { monto: 150, nota: 'hola' },
  organizationId = env.organization.id,
) {
  return api(env)
    .post(runsPath(organizationId, workflowId))
    .set(authHeaders(session))
    .send({ input });
}

export async function getRun(
  env: Pick<WorkflowsEnv, 'app' | 'organization'>,
  session: LoggedIn,
  runId: string,
  organizationId = env.organization.id,
): Promise<RunDetail> {
  const response = await api(env)
    .get(runPath(organizationId, runId))
    .set('Cookie', session.cookie)
    .expect(200);
  return response.body as RunDetail;
}

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'timed_out']);

export function waitForTerminal(
  env: Pick<WorkflowsEnv, 'app' | 'organization'>,
  session: LoggedIn,
  runId: string,
  timeoutMs = 30_000,
): Promise<RunDetail> {
  return waitFor(async () => {
    const run = await getRun(env, session, runId);
    return TERMINAL.has(run.status) ? run : undefined;
  }, timeoutMs);
}

export function waitForStatus(
  env: Pick<WorkflowsEnv, 'app' | 'organization'>,
  session: LoggedIn,
  runId: string,
  status: Run['status'],
  timeoutMs = 20_000,
): Promise<RunDetail> {
  return waitFor(async () => {
    const run = await getRun(env, session, runId);
    return run.status === status ? run : undefined;
  }, timeoutMs);
}

export interface SseMessage {
  id?: string;
  event?: string;
  data?: unknown;
  comment?: string;
}

export function parseSse(chunk: string): SseMessage[] {
  const messages: SseMessage[] = [];
  for (const block of chunk.split('\n\n')) {
    if (block.trim() === '') continue;
    const message: SseMessage = {};
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) message.comment = line.slice(1).trim();
      else if (line.startsWith('id:')) message.id = line.slice(3).trim();
      else if (line.startsWith('event:')) message.event = line.slice(6).trim();
      else if (line.startsWith('data:')) message.data = JSON.parse(line.slice(5).trim());
    }
    messages.push(message);
  }
  return messages;
}

export interface SseConnection {
  status: number;
  contentType: string | null;
  messages: SseMessage[];
  /** Resolves when the server ends the stream. */
  closed: Promise<void>;
  close(): void;
}

/** Reads a Server-Sent Events response as it arrives. */
export async function openSse(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
): Promise<SseConnection> {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}${path}`, { headers, signal: controller.signal });
  const messages: SseMessage[] = [];
  let buffer = '';
  const closed = (async () => {
    if (!response.body || response.status !== 200) return;
    const decoder = new TextDecoder();
    try {
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk as Uint8Array, { stream: true });
        const end = buffer.lastIndexOf('\n\n');
        if (end === -1) continue;
        messages.push(...parseSse(buffer.slice(0, end + 2)));
        buffer = buffer.slice(end + 2);
      }
    } catch {
      // Aborted by close().
    }
  })();
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    messages,
    closed,
    close: () => controller.abort(),
  };
}

/** Listens the app on an ephemeral port: supertest cannot stream. */
export async function listen(app: INestApplication): Promise<string> {
  await app.listen(0, '127.0.0.1');
  const address = httpServer(app).address();
  if (address === null || typeof address === 'string') throw new Error('No TCP address');
  return `http://127.0.0.1:${address.port}`;
}
