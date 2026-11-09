import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { Client, Connection } from '@temporalio/client';
import { NativeConnection } from '@temporalio/worker';
import Valkey from 'iovalkey';
import request from 'supertest';
import type { Approval, Run, WebhookWithToken } from '@cognitive-dag/contracts';
import { createLogger } from '@cognitive-dag/logger';
import { createScheduleReconciler } from '../../../worker/src/schedules/reconciler';
import { createWorker } from '../../../worker/src/worker';
import { httpServer, startTestApp, testConfig } from './helpers';
import { authHeaders, type LoggedIn } from './identity-helpers';
import { joinAs } from './members-helpers';
import { uniqueTaskQueue, waitFor, type RunningWorker } from './ping-helpers';
import {
  closeWorkflowsEnv,
  createWorkflow,
  publish,
  saveDraft,
  setupWorkflowsEnv,
  workflowsPath,
  type WorkflowsEnv,
} from './workflows-helpers';

export const TRIGGER_FLAGS = '{}';

/** A fixed master key for tests: 32 bytes of one value, never a real key. */
export const TEST_MASTER_KEY = Buffer.alloc(32, 7);

export interface TriggersEnv extends WorkflowsEnv {
  taskQueue: string;
  worker: RunningWorker;
  valkey: Valkey;
  temporal: Client;
  /** A second editor, to decide what the first one started. */
  secondEditor: LoggedIn;
  reconcile(): Promise<{ synced: number; failed: number }>;
}

export async function setupTriggersEnv(
  overrides: Parameters<typeof startTestApp>[0] = {},
  options: { flags?: string; withWorker?: boolean } = {},
): Promise<TriggersEnv> {
  const flags = options.flags ?? TRIGGER_FLAGS;
  const taskQueue = uniqueTaskQueue();
  const base = await setupWorkflowsEnv(flags);
  // setupWorkflowsEnv built its own app on a random queue: replace it with one that shares ours.
  await base.app.close();
  const app = await startTestApp({
    FEATURE_FLAGS: flags,
    TEMPORAL_TASK_QUEUE: taskQueue,
    credentialsMasterKey: TEST_MASTER_KEY,
    ...overrides,
  });
  const config = testConfig();
  const valkey = new Valkey(config.VALKEY_URL);
  const worker =
    options.withWorker === false
      ? { worker: undefined as never, stop: () => Promise.resolve() }
      : await startWorker(taskQueue, base.database, valkey);
  const connection = await Connection.connect({ address: config.TEMPORAL_ADDRESS });
  const temporal = new Client({ connection, namespace: config.TEMPORAL_NAMESPACE });
  const secondEditor = (
    await joinAs(app, base.database, base.owner, base.organization.id, 'editor')
  ).session;
  const reconciler = createScheduleReconciler({
    withContext: base.database.withContext,
    client: temporal,
    taskQueue,
    catchupWindowSeconds: 3600,
    triggersOn: true,
    logger: createLogger({ component: 'test-reconciler', level: 'silent' }),
  });
  return {
    ...base,
    app,
    taskQueue,
    worker,
    valkey,
    temporal,
    secondEditor,
    reconcile: () => reconciler.reconcileOnce(),
  };
}

async function startWorker(
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
    triggers: {
      triggersOn: true,
      llmEnabled: false,
      llmTaskQueue: 'unused-llm-queue',
      httpTaskQueue: 'unused-http-queue',
      mailer: { send: () => Promise.resolve(), close: () => undefined },
      approvalMaxRecipients: 20,
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

export async function closeTriggersEnv(env: TriggersEnv): Promise<void> {
  await env.worker.stop();
  env.valkey.disconnect();
  await env.temporal.connection.close();
  await closeWorkflowsEnv(env);
}

const node = (id: string, type: string, config: unknown, x = 0) => ({
  id,
  type,
  label: id,
  position: { x, y: 0 },
  config,
});
const edge = (source: string, target: string, handle = 'out') => ({
  id: `${source}_${target}`,
  source,
  sourceHandle: handle,
  target,
});
const mock = (id: string, x = 200, latencyMs = 100) =>
  node(id, 'mock.service', { latencyMs, failureRate: 0, failureKind: 'permanent' }, x);

export const webhookDefinition = (bodySchema: unknown[] = [], latencyMs = 100) => ({
  schemaVersion: 1,
  nodes: [node('hook', 'trigger.webhook', { bodySchema }), mock('work', 200, latencyMs)],
  edges: [edge('hook', 'work')],
});

export const scheduleDefinition = (cron = '*/5 * * * *', timezone = 'UTC') => ({
  schemaVersion: 1,
  nodes: [node('tick', 'trigger.schedule', { cron, timezone }), mock('work')],
  edges: [edge('tick', 'work')],
});

/** trigger -> ask -(approved)-> go ; -(rejected)-> stop ; -(timeout)-> late */
export const approvalDefinition = (message = 'Aprueba el pedido', timeoutSeconds = 3600) => ({
  schemaVersion: 1,
  nodes: [
    node('trigger', 'trigger.manual', { inputSchema: [] }),
    node('ask', 'human.approval', { message, timeoutSeconds }, 200),
    mock('go', 400),
    mock('stop', 400),
    mock('late', 400),
  ],
  edges: [
    edge('trigger', 'ask'),
    edge('ask', 'go', 'approved'),
    edge('ask', 'stop', 'rejected'),
    edge('ask', 'late', 'timeout'),
  ],
});

/** `trigger.webhook` -> ask -(approved)-> go, so a run with no person behind it can wait. */
export const webhookApprovalDefinition = () => ({
  schemaVersion: 1,
  nodes: [
    node('hook', 'trigger.webhook', { bodySchema: [] }),
    node('ask', 'human.approval', { message: 'Aprueba el webhook', timeoutSeconds: 3600 }, 200),
    mock('go', 400),
    mock('stop', 400),
    mock('late', 400),
  ],
  edges: [
    edge('hook', 'ask'),
    edge('ask', 'go', 'approved'),
    edge('ask', 'stop', 'rejected'),
    edge('ask', 'late', 'timeout'),
  ],
});

/** Creates a workflow, saves the definition and publishes it (which activates it). */
export async function publishedWorkflow(
  env: WorkflowsEnv,
  definition: unknown,
  session: LoggedIn = env.owner,
): Promise<{ id: string; versionNumber: number }> {
  const workflow = await createWorkflow(env, session);
  const saved = await saveDraft(env, session, workflow.id, 1, definition).expect(200);
  const revision = (saved.body as { revision: number }).revision;
  const version = await publish(env, session, workflow.id, revision).expect(201);
  return { id: workflow.id, versionNumber: (version.body as { number: number }).number };
}

export const server = (env: Pick<WorkflowsEnv, 'app'>): Server => httpServer(env.app);
export const api = (env: Pick<WorkflowsEnv, 'app'>) => request(server(env));

export const orgPath = (env: Pick<WorkflowsEnv, 'organization'>) =>
  `/api/v1/organizations/${env.organization.id}`;

export async function generateWebhook(
  env: WorkflowsEnv,
  workflowId: string,
  session: LoggedIn = env.owner,
): Promise<WebhookWithToken & { path: string }> {
  const response = await api(env)
    .post(`${workflowsPath(env.organization.id)}/${workflowId}/webhook/token`)
    .set(authHeaders(session))
    .expect(201);
  const body = response.body as WebhookWithToken;
  return { ...body, path: new URL(body.url).pathname };
}

/** Headers a well-formed webhook call carries. */
export const hookHeaders = (eventId: string = randomUUID(), at = new Date()) => ({
  'Content-Type': 'application/json',
  'X-Event-Id': eventId,
  'X-Event-Timestamp': at.toISOString(),
});

export function postHook(
  env: Pick<WorkflowsEnv, 'app'>,
  path: string,
  body: unknown = {},
  headers: Record<string, string> = hookHeaders(),
) {
  return api(env).post(path).set(headers).send(JSON.stringify(body));
}

/** The pending approvals the person sees, once at least `count` exist. */
export async function waitForPending(
  env: WorkflowsEnv,
  session: LoggedIn,
  count = 1,
): Promise<Approval[]> {
  return waitFor(async () => {
    const response = await api(env)
      .get(`${orgPath(env)}/approvals?status=pending`)
      .set(authHeaders(session));
    const items = (response.body as { items?: Approval[] }).items ?? [];
    return items.length >= count ? items : undefined;
  }, 30_000);
}

export async function startManualRun(
  env: WorkflowsEnv,
  session: LoggedIn,
  workflowId: string,
): Promise<Run> {
  const response = await api(env)
    .post(`${workflowsPath(env.organization.id)}/${workflowId}/runs`)
    .set(authHeaders(session))
    .send({ input: {} })
    .expect(202);
  return response.body as Run;
}

/** The fields of a problem+json body the tests look at. */
export interface ProblemBody {
  code: string;
  detail: string;
  reason?: string;
  nodes?: unknown;
  dagErrors?: unknown;
}

/** `response.body` is `any` in supertest: this gives it the shape of an API problem. */
export const problemOf = (response: { body: unknown }): ProblemBody => response.body as ProblemBody;
