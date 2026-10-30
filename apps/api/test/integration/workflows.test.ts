import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ProblemDetailsSchema,
  WorkflowSchema,
  WorkflowSummarySchema,
  type WorkflowSummary,
} from '@cognitive-dag/contracts';
import { httpServer } from './helpers';
import {
  authHeaders,
  createVerifiedUser,
  loginAs,
  openDatabase,
  resetRateLimits,
  startIdentityApp,
} from './identity-helpers';
import { uniqueTaskQueue } from './ping-helpers';
import {
  api,
  closeWorkflowsEnv,
  createWorkflow,
  setupWorkflowsEnv,
  uniqueName,
  workflowsPath,
  type WorkflowsEnv,
} from './workflows-helpers';

async function expectProblem(response: request.Test, status: number, code: string) {
  const result = await response.expect(status);
  expect(result.headers['content-type']).toContain('application/problem+json');
  expect(ProblemDetailsSchema.parse(result.body).code).toBe(code);
}

describe('workflows (requires docker compose up and pnpm db:migrate)', () => {
  let env: WorkflowsEnv;
  const base = () => workflowsPath(env.organization.id);

  beforeAll(async () => {
    env = await setupWorkflowsEnv();
  });

  afterAll(async () => {
    await closeWorkflowsEnv(env);
  });

  beforeEach(resetRateLimits);

  it('creates a workflow with an empty draft at revision 1', async () => {
    const name = uniqueName('Reembolsos');
    const response = await api(env)
      .post(base())
      .set(authHeaders(env.editor))
      .send({ name })
      .expect(201);
    const body = WorkflowSchema.parse(response.body);
    expect(body).toMatchObject({
      name,
      draftRevision: 1,
      activeVersionNumber: null,
      draft: { schemaVersion: 1, nodes: [], edges: [] },
    });
    expect(response.headers.etag).toBe('"1"');
  });

  it('lists the workflows of the organization, and viewers can read them', async () => {
    const created = await createWorkflow(env);
    const response = await api(env).get(base()).set('Cookie', env.viewer.cookie).expect(200);
    const list = (response.body as unknown[]).map((item) => WorkflowSummarySchema.parse(item));
    expect(list.map((item) => item.id)).toContain(created.id);
  });

  it('gets a workflow with its draft, revision and validation', async () => {
    const created = await createWorkflow(env);
    const response = await api(env)
      .get(`${base()}/${created.id}`)
      .set('Cookie', env.viewer.cookie)
      .expect(200);
    const body = WorkflowSchema.parse(response.body);
    expect(body.id).toBe(created.id);
    expect(body.draftValidation?.valid).toBe(false);
    expect(response.headers.etag).toBe('"1"');
  });

  it('renames a workflow', async () => {
    const created = await createWorkflow(env);
    const name = uniqueName('Renombrado');
    const response = await api(env)
      .patch(`${base()}/${created.id}`)
      .set(authHeaders(env.editor))
      .send({ name })
      .expect(200);
    expect((response.body as WorkflowSummary).name).toBe(name);
  });

  it('409 WORKFLOW_NAME_TAKEN for a repeated name when creating and when renaming', async () => {
    const first = await createWorkflow(env);
    await expectProblem(
      api(env).post(base()).set(authHeaders(env.owner)).send({ name: first.name }),
      409,
      'WORKFLOW_NAME_TAKEN',
    );
    const second = await createWorkflow(env);
    await expectProblem(
      api(env)
        .patch(`${base()}/${second.id}`)
        .set(authHeaders(env.owner))
        .send({ name: first.name }),
      409,
      'WORKFLOW_NAME_TAKEN',
    );
  });

  it('allows the same name in another organization', async () => {
    const first = await createWorkflow(env);
    await createWorkflow(env, env.outsider, first.name, env.outsiderOrganization.id);
  });

  it.each([
    ['empty name', { name: '' }],
    ['name over 100 characters', { name: 'x'.repeat(101) }],
    ['unknown field', { name: 'ok', extra: true }],
    ['missing name', {}],
  ])('422 VALIDATION_FAILED for %s', async (_label, body) => {
    await expectProblem(
      api(env).post(base()).set(authHeaders(env.owner)).send(body),
      422,
      'VALIDATION_FAILED',
    );
  });

  describe('archiving', () => {
    it('only the owner archives; the workflow then disappears and its name is free', async () => {
      const created = await createWorkflow(env);
      await expectProblem(
        api(env).delete(`${base()}/${created.id}`).set(authHeaders(env.editor)),
        403,
        'FORBIDDEN',
      );
      await expectProblem(
        api(env).delete(`${base()}/${created.id}`).set(authHeaders(env.viewer)),
        403,
        'FORBIDDEN',
      );
      await api(env).delete(`${base()}/${created.id}`).set(authHeaders(env.owner)).expect(204);

      await expectProblem(
        api(env).get(`${base()}/${created.id}`).set('Cookie', env.owner.cookie),
        404,
        'NOT_FOUND',
      );
      const list = await api(env).get(base()).set('Cookie', env.owner.cookie).expect(200);
      expect((list.body as WorkflowSummary[]).map((item) => item.id)).not.toContain(created.id);
      await createWorkflow(env, env.owner, created.name);
    });

    it('404 when archiving twice or when renaming an archived workflow', async () => {
      const created = await createWorkflow(env);
      await api(env).delete(`${base()}/${created.id}`).set(authHeaders(env.owner)).expect(204);
      await expectProblem(
        api(env).delete(`${base()}/${created.id}`).set(authHeaders(env.owner)),
        404,
        'NOT_FOUND',
      );
      await expectProblem(
        api(env).patch(`${base()}/${created.id}`).set(authHeaders(env.owner)).send({ name: 'x' }),
        404,
        'NOT_FOUND',
      );
    });
  });

  describe('roles', () => {
    it('a viewer reads but cannot create, rename or archive: 403', async () => {
      const created = await createWorkflow(env);
      await expectProblem(
        api(env).post(base()).set(authHeaders(env.viewer)).send({ name: uniqueName() }),
        403,
        'FORBIDDEN',
      );
      await expectProblem(
        api(env).patch(`${base()}/${created.id}`).set(authHeaders(env.viewer)).send({ name: 'x' }),
        403,
        'FORBIDDEN',
      );
      await expectProblem(
        api(env).delete(`${base()}/${created.id}`).set(authHeaders(env.viewer)),
        403,
        'FORBIDDEN',
      );
    });

    it('401 without a session and 403 CSRF_REJECTED without the token', async () => {
      await expectProblem(api(env).get(base()), 401, 'UNAUTHENTICATED');
      await expectProblem(
        api(env).post(base()).set('Cookie', env.owner.cookie).send({ name: uniqueName() }),
        403,
        'CSRF_REJECTED',
      );
    });
  });

  describe('another organization', () => {
    it('404 for every operation on an organization the user does not belong to', async () => {
      const created = await createWorkflow(env);
      const foreign = `${base()}/${created.id}`;
      await expectProblem(
        api(env).get(base()).set('Cookie', env.outsider.cookie),
        404,
        'NOT_FOUND',
      );
      await expectProblem(
        api(env).get(foreign).set('Cookie', env.outsider.cookie),
        404,
        'NOT_FOUND',
      );
      await expectProblem(
        api(env).patch(foreign).set(authHeaders(env.outsider)).send({ name: 'x' }),
        404,
        'NOT_FOUND',
      );
      await expectProblem(
        api(env).delete(foreign).set(authHeaders(env.outsider)),
        404,
        'NOT_FOUND',
      );
    });

    it('404 for a workflow of another organization reached through the user own organization', async () => {
      const created = await createWorkflow(env);
      const own = workflowsPath(env.outsiderOrganization.id);
      await expectProblem(
        api(env).get(`${own}/${created.id}`).set('Cookie', env.outsider.cookie),
        404,
        'NOT_FOUND',
      );
      await expectProblem(
        api(env).get(`${own}/${randomUUID()}`).set('Cookie', env.outsider.cookie),
        404,
        'NOT_FOUND',
      );
    });
  });
});

describe('workflows behind dag-editor-enabled', () => {
  const apps: INestApplication[] = [];

  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()));
  });

  it.each([
    ['flag false', '{"ping-enabled":true,"identity-enabled":true,"dag-editor-enabled":false}'],
    ['flag missing', '{"ping-enabled":true,"identity-enabled":true}'],
  ])(
    'answers 404 FEATURE_NOT_AVAILABLE with %s, even with a valid session',
    async (_label, flags) => {
      const app = await startIdentityApp(flags, { TEMPORAL_TASK_QUEUE: uniqueTaskQueue() });
      apps.push(app);
      const database = openDatabase();
      try {
        const user = await createVerifiedUser(app, database, 'flag-off');
        const session = await loginAs(app, user);
        const organizationId = session.body.organizations[0]!.id;
        const server = httpServer(app);
        const path = workflowsPath(organizationId);
        const calls = [
          // Built one at a time: each supertest request opens its own listener.
          () => request(server).get(path).set('Cookie', session.cookie),
          () => request(server).post(path).set(authHeaders(session)).send({ name: 'x' }),
          () => request(server).get(`${path}/${randomUUID()}`).set('Cookie', session.cookie),
          () =>
            request(server)
              .put(`${path}/${randomUUID()}/draft`)
              .set(authHeaders(session))
              .set('If-Match', '"1"')
              .send({ definition: {} }),
          () =>
            request(server)
              .post(`${path}/${randomUUID()}/versions`)
              .set(authHeaders(session))
              .set('If-Match', '"1"'),
          () =>
            request(server)
              .get(`/api/v1/organizations/${organizationId}/limits`)
              .set('Cookie', session.cookie),
        ];
        for (const call of calls) await expectProblem(call(), 404, 'FEATURE_NOT_AVAILABLE');
      } finally {
        await database.end();
      }
    },
  );
});
