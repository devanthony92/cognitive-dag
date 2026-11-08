import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Webhook, WebhookWithToken } from '@cognitive-dag/contracts';
import { authHeaders } from './identity-helpers';
import {
  api,
  closeTriggersEnv,
  publishedWorkflow,
  setupTriggersEnv,
  webhookDefinition,
  type TriggersEnv,
  problemOf,
} from './triggers-helpers';
import { createWorkflow, workflowsPath } from './workflows-helpers';

let env: TriggersEnv;

beforeAll(async () => {
  env = await setupTriggersEnv({}, { withWorker: false });
}, 120_000);

afterAll(async () => {
  await closeTriggersEnv(env);
});

const base = (workflowId: string, organizationId = env.organization.id) =>
  `${workflowsPath(organizationId)}/${workflowId}/webhook`;

describe('webhook token management', () => {
  it('generates the token once, with no-store, and never returns it again', async () => {
    const workflow = await createWorkflow(env);
    const created = await api(env)
      .post(`${base(workflow.id)}/token`)
      .set(authHeaders(env.owner))
      .expect(201);
    expect(created.headers['cache-control']).toBe('no-store');
    const body = created.body as WebhookWithToken;
    expect(body.url).toMatch(/\/api\/v1\/hooks\/[0-9a-f-]{36}\/cdw_[A-Za-z0-9_-]{43}$/);
    expect(body.generation).toBe(1);
    expect(body.urlBase).toMatch(/\/api\/v1\/hooks\/[0-9a-f-]{36}\/$/);
    expect(body.active).toBe(false);

    const state = await api(env).get(base(workflow.id)).set(authHeaders(env.owner)).expect(200);
    expect(JSON.stringify(state.body)).not.toContain('cdw_');
    expect(state.body).not.toHaveProperty('url');
    expect((state.body as Webhook).generation).toBe(1);
    expect((state.body as Webhook).generatedBy.id).toBe(env.owner.body.user.id);
  });

  it('regenerates: the generation grows, the trigger id stays and the URL changes', async () => {
    const workflow = await createWorkflow(env);
    const first = (
      await api(env)
        .post(`${base(workflow.id)}/token`)
        .set(authHeaders(env.owner))
        .expect(201)
    ).body as WebhookWithToken;
    const second = (
      await api(env)
        .post(`${base(workflow.id)}/token`)
        .set(authHeaders(env.editor))
        .expect(201)
    ).body as WebhookWithToken;
    expect(second.generation).toBe(2);
    expect(second.urlBase).toBe(first.urlBase);
    expect(second.url).not.toBe(first.url);
    expect(second.generatedBy.id).toBe(env.editor.body.user.id);
  });

  it('answers 404 before a token exists, and reports whether a webhook version is active', async () => {
    const empty = await createWorkflow(env);
    await api(env).get(base(empty.id)).set(authHeaders(env.owner)).expect(404);

    const workflow = await publishedWorkflow(env, webhookDefinition());
    await api(env)
      .post(`${base(workflow.id)}/token`)
      .set(authHeaders(env.owner))
      .expect(201);
    const state = await api(env).get(base(workflow.id)).set(authHeaders(env.owner)).expect(200);
    expect((state.body as Webhook).active).toBe(true);
  });

  it('lets a viewer read the state but not generate a token', async () => {
    const workflow = await createWorkflow(env);
    await api(env)
      .post(`${base(workflow.id)}/token`)
      .set(authHeaders(env.owner))
      .expect(201);
    await api(env).get(base(workflow.id)).set(authHeaders(env.viewer)).expect(200);
    const denied = await api(env)
      .post(`${base(workflow.id)}/token`)
      .set(authHeaders(env.viewer))
      .expect(403);
    expect(problemOf(denied).code).toBe('FORBIDDEN');
  });

  it('answers 404 to a member of another organization, for read and write', async () => {
    const workflow = await createWorkflow(env);
    await api(env)
      .post(`${base(workflow.id)}/token`)
      .set(authHeaders(env.owner))
      .expect(201);
    await api(env).get(base(workflow.id)).set(authHeaders(env.outsider)).expect(404);
    await api(env)
      .post(`${base(workflow.id)}/token`)
      .set(authHeaders(env.outsider))
      .expect(404);
    // Their own organization, but a workflow that is not theirs.
    await api(env)
      .post(`${base(workflow.id, env.outsiderOrganization.id)}/token`)
      .set(authHeaders(env.outsider))
      .expect(404);
  });
});
