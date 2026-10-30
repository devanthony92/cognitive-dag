import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import request from 'supertest';
import type { OrganizationSummary, WorkflowBody } from '@cognitive-dag/contracts';
import type { DatabaseClient } from '@cognitive-dag/db';
import { httpServer } from './helpers';
import {
  authHeaders,
  createVerifiedUser,
  loginAs,
  openDatabase,
  resetRateLimits,
  startIdentityApp,
  type LoggedIn,
} from './identity-helpers';
import { createOrganization, joinAs } from './members-helpers';
import { uniqueTaskQueue } from './ping-helpers';

export const DAG_FLAGS = '{"ping-enabled":true,"identity-enabled":true,"dag-editor-enabled":true}';

export interface WorkflowsEnv {
  app: INestApplication;
  database: DatabaseClient;
  organization: OrganizationSummary;
  owner: LoggedIn;
  editor: LoggedIn;
  viewer: LoggedIn;
  /** A member of a different organization. */
  outsider: LoggedIn;
  outsiderOrganization: OrganizationSummary;
}

/** An app with the flag on, one organization with its three roles and an outsider. */
export async function setupWorkflowsEnv(flags = DAG_FLAGS): Promise<WorkflowsEnv> {
  const app = await startIdentityApp(flags, { TEMPORAL_TASK_QUEUE: uniqueTaskQueue() });
  const database = openDatabase();
  await resetRateLimits();
  const ownerUser = await createVerifiedUser(app, database, 'wf-owner');
  const owner = await loginAs(app, ownerUser);
  const organization = await createOrganization(app, owner, 'Equipo de workflows');
  const editor = (await joinAs(app, database, owner, organization.id, 'editor')).session;
  const viewer = (await joinAs(app, database, owner, organization.id, 'viewer')).session;
  const outsiderUser = await createVerifiedUser(app, database, 'wf-outsider');
  const outsider = await loginAs(app, outsiderUser);
  return {
    app,
    database,
    organization,
    owner,
    editor,
    viewer,
    outsider,
    outsiderOrganization: outsider.body.organizations[0]!,
  };
}

export async function closeWorkflowsEnv(env: WorkflowsEnv): Promise<void> {
  await env.app.close();
  await env.database.end();
}

export const workflowsPath = (organizationId: string) =>
  `/api/v1/organizations/${organizationId}/workflows`;

export const api = (env: Pick<WorkflowsEnv, 'app'>) => request(httpServer(env.app));

export const quoted = (revision: number) => `"${revision}"`;

let counter = 0;
export const uniqueName = (label = 'Flujo') => `${label} ${Date.now()}-${(counter += 1)}`;

export async function createWorkflow(
  env: WorkflowsEnv,
  session: LoggedIn = env.owner,
  name = uniqueName(),
  organizationId = env.organization.id,
): Promise<WorkflowBody> {
  const response = await api(env)
    .post(workflowsPath(organizationId))
    .set(authHeaders(session))
    .send({ name })
    .expect(201);
  return response.body as WorkflowBody;
}

/** A manual trigger connected to a simulated service: the smallest valid DAG. */
export function validDefinition(extra: { padNodes?: number; pad?: number } = {}) {
  const nodes: Record<string, unknown>[] = [
    {
      id: 'trigger',
      type: 'trigger.manual',
      label: 'Inicio',
      position: { x: 0, y: 0 },
      config: { inputSchema: [] },
    },
    {
      id: 'work',
      type: 'mock.service',
      label: 'Trabajo',
      position: { x: 200, y: 0 },
      config: { latencyMs: 100, failureRate: 0, failureKind: 'transient' },
    },
  ];
  const edges: Record<string, unknown>[] = [
    { id: 'e1', source: 'trigger', sourceHandle: 'out', target: 'work' },
  ];
  for (let i = 0; i < (extra.padNodes ?? 0); i += 1) {
    nodes.push({
      id: `text_${i}`,
      type: 'llm.generate',
      label: `Texto ${i}`,
      position: { x: 400, y: i * 50 },
      config: { instruction: 'x'.repeat(extra.pad ?? 100), language: 'es', maxLength: 1000 },
    });
    edges.push({ id: `e_text_${i}`, source: 'work', sourceHandle: 'out', target: `text_${i}` });
  }
  return { schemaVersion: 1, nodes, edges };
}

/** A definition with errors: it has a node but no trigger. */
export function invalidDefinition() {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: 'work',
        type: 'mock.service',
        label: 'Trabajo',
        position: { x: 0, y: 0 },
        config: { latencyMs: 100, failureRate: 0, failureKind: 'transient' },
      },
    ],
    edges: [],
  };
}

export function saveDraft(
  env: WorkflowsEnv,
  session: LoggedIn,
  workflowId: string,
  revision: number,
  definition: unknown,
  organizationId = env.organization.id,
) {
  return api(env)
    .put(`${workflowsPath(organizationId)}/${workflowId}/draft`)
    .set(authHeaders(session))
    .set('If-Match', quoted(revision))
    .send({ definition });
}

export function publish(
  env: WorkflowsEnv,
  session: LoggedIn,
  workflowId: string,
  revision: number,
  note?: string,
  organizationId = env.organization.id,
) {
  const call = api(env)
    .post(`${workflowsPath(organizationId)}/${workflowId}/versions`)
    .set(authHeaders(session))
    .set('If-Match', quoted(revision));
  return note === undefined ? call : call.send({ note });
}

/** A workflow whose draft is the valid definition, at the revision returned. */
export async function workflowWithValidDraft(
  env: WorkflowsEnv,
  session: LoggedIn = env.owner,
): Promise<{ id: string; revision: number }> {
  const workflow = await createWorkflow(env, session);
  const saved = await saveDraft(env, session, workflow.id, 1, validDefinition()).expect(200);
  return { id: workflow.id, revision: (saved.body as { revision: number }).revision };
}

/** What the operator script does: app_migrator writes through its own policy. */
export async function setLimitsAsOperator(
  organizationId: string,
  limits: { maxNodes: number; maxEdges: number; maxDefinitionBytes: number },
): Promise<void> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_MIGRATOR_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO organization_limits
         (organization_id, max_nodes, max_edges, max_definition_bytes, updated_by)
       VALUES ($1, $2, $3, $4, 'api-test')
       ON CONFLICT (organization_id) DO UPDATE SET
         max_nodes = EXCLUDED.max_nodes, max_edges = EXCLUDED.max_edges,
         max_definition_bytes = EXCLUDED.max_definition_bytes, updated_at = now()`,
      [organizationId, limits.maxNodes, limits.maxEdges, limits.maxDefinitionBytes],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

export const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest();

/** A user in a fresh organization of their own, to test per-organization limits in isolation. */
export async function freshOrganization(env: WorkflowsEnv): Promise<{
  session: LoggedIn;
  organizationId: string;
}> {
  const user = await createVerifiedUser(env.app, env.database, 'wf-limits');
  const session = await loginAs(env.app, user);
  return { session, organizationId: session.body.organizations[0]!.id };
}
