import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProblemDetailsSchema, RunSchema, type Role } from '@cognitive-dag/contracts';
import { RunsController } from '../../src/runs/runs.controller';
import { REQUIRED_ROLES } from '../../src/organizations/required-roles.decorator';
import { authHeaders, createVerifiedUser, loginAs, type LoggedIn } from './identity-helpers';
import { joinAs } from './members-helpers';
import {
  amountDefinition,
  api,
  chainDefinition,
  closeRunsEnv,
  listen,
  openSse,
  publishedWorkflow,
  runPath,
  setupRunsEnv,
  slowDefinition,
  startRun,
  waitForTerminal,
  type RunsEnv,
} from './runs-helpers';

/**
 * Execution roles (F8 US2, ADR-0082, replaces ADR-0053): only owner and editor start, cancel and
 * rerun runs; the viewer only reads. Requires docker compose up and pnpm db:migrate.
 */
describe('execution roles by route (requires docker compose up and pnpm db:migrate)', () => {
  let env: RunsEnv;
  let nonMember: LoggedIn;

  beforeAll(async () => {
    env = await setupRunsEnv();
    const user = await createVerifiedUser(env.app, env.database, 'runs-nonmember');
    nonMember = await loginAs(env.app, user);
  });

  afterAll(async () => {
    await closeRunsEnv(env);
  });

  const cancel = (runId: string, session: LoggedIn, organizationId = env.organization.id) =>
    api(env)
      .post(`${runPath(organizationId, runId)}/cancel`)
      .set(authHeaders(session));
  const rerun = (
    runId: string,
    session: LoggedIn,
    body: Record<string, unknown> = {},
    organizationId = env.organization.id,
  ) =>
    api(env)
      .post(`${runPath(organizationId, runId)}/rerun`)
      .set(authHeaders(session))
      .send(body);

  /** Role → expected status for a route that starts effects (spec US2 matrix). */
  const EXPECTED = [
    ['owner', 202],
    ['editor', 202],
    ['viewer', 403],
  ] as const;

  const sessionOf = (role: Role) =>
    ({ owner: env.owner, editor: env.editor, viewer: env.viewer })[role];

  async function finishedRun(definition: unknown = amountDefinition()) {
    const workflowId = await publishedWorkflow(env, definition);
    const run = RunSchema.parse((await startRun(env, env.owner, workflowId).expect(202)).body);
    await waitForTerminal(env, env.owner, run.id);
    return { workflowId, run };
  }

  describe('start', () => {
    it.each(EXPECTED)('%s → %i', async (role, status) => {
      const workflowId = await publishedWorkflow(env, amountDefinition());
      const response = await startRun(env, sessionOf(role), workflowId).expect(status);
      if (status === 202) {
        await waitForTerminal(env, env.owner, RunSchema.parse(response.body).id);
      } else {
        expect(ProblemDetailsSchema.parse(response.body).code).toBe('FORBIDDEN');
        const list = await api(env)
          .get(`/api/v1/organizations/${env.organization.id}/workflows/${workflowId}/runs`)
          .set('Cookie', env.owner.cookie)
          .expect(200);
        expect((list.body as { items: unknown[] }).items).toHaveLength(0);
      }
    });

    it('404 for a non member and for a member of another organization', async () => {
      const workflowId = await publishedWorkflow(env, amountDefinition());
      await startRun(env, nonMember, workflowId).expect(404);
      await startRun(env, env.outsider, workflowId).expect(404);
    });
  });

  describe('cancel', () => {
    it.each(EXPECTED)('%s → %i', async (role, status) => {
      const workflowId = await publishedWorkflow(env, slowDefinition());
      const run = RunSchema.parse((await startRun(env, env.owner, workflowId).expect(202)).body);
      const response = await cancel(run.id, sessionOf(role)).expect(status);
      if (status === 403) {
        expect(ProblemDetailsSchema.parse(response.body).code).toBe('FORBIDDEN');
        // Nothing changed: it is still alive, so the owner cancels it to free the organization.
        await cancel(run.id, env.owner).expect(202);
      }
      const done = await waitForTerminal(env, env.owner, run.id);
      expect(done.status).toBe('cancelled');
    });

    it('404 for a non member and for a member of another organization', async () => {
      const workflowId = await publishedWorkflow(env, slowDefinition());
      const run = RunSchema.parse((await startRun(env, env.owner, workflowId).expect(202)).body);
      await cancel(run.id, nonMember).expect(404);
      await cancel(run.id, env.outsider).expect(404);
      await cancel(run.id, env.outsider, env.outsiderOrganization.id).expect(404);
      await cancel(run.id, env.owner).expect(202);
      await waitForTerminal(env, env.owner, run.id);
    });
  });

  describe('rerun (whole run)', () => {
    it.each(EXPECTED)('%s → %i', async (role, status) => {
      const { run } = await finishedRun();
      const response = await rerun(run.id, sessionOf(role)).expect(status);
      if (status === 202) {
        await waitForTerminal(env, env.owner, RunSchema.parse(response.body).id);
      } else {
        expect(ProblemDetailsSchema.parse(response.body).code).toBe('FORBIDDEN');
      }
    });

    it('404 for a non member and for a member of another organization', async () => {
      const { run } = await finishedRun();
      await rerun(run.id, nonMember).expect(404);
      await rerun(run.id, env.outsider).expect(404);
      await rerun(run.id, env.outsider, {}, env.outsiderOrganization.id).expect(404);
    });
  });

  describe('rerun from a node', () => {
    it.each(EXPECTED)('%s → %i', async (role, status) => {
      const { run } = await finishedRun(chainDefinition(false));
      const response = await rerun(run.id, sessionOf(role), { fromNodeId: 'b' }).expect(status);
      if (status === 202) {
        await waitForTerminal(env, env.owner, RunSchema.parse(response.body).id);
      } else {
        expect(ProblemDetailsSchema.parse(response.body).code).toBe('FORBIDDEN');
      }
    });

    it('404 for a non member and for a member of another organization', async () => {
      const { run } = await finishedRun(chainDefinition(false));
      await rerun(run.id, nonMember, { fromNodeId: 'b' }).expect(404);
      await rerun(run.id, env.outsider, { fromNodeId: 'b' }).expect(404);
    });
  });

  describe('reads stay open to the viewer', () => {
    it('lists, details, step input and output, and the live stream answer 200', async () => {
      const { workflowId, run } = await finishedRun();
      const org = env.organization.id;
      const get = (path: string) => api(env).get(path).set('Cookie', env.viewer.cookie);
      await get(`/api/v1/organizations/${org}/workflows/${workflowId}/runs`).expect(200);
      await get(`/api/v1/organizations/${org}/runs`).expect(200);
      await get(runPath(org, run.id)).expect(200);
      await get(`${runPath(org, run.id)}/steps/trigger/io`).expect(200);

      const baseUrl = await listen(env.app);
      const stream = await openSse(baseUrl, `${runPath(org, run.id)}/events`, {
        Cookie: env.viewer.cookie,
      });
      expect(stream.status).toBe(200);
      stream.close();
    });
  });

  describe('the role is read on every request', () => {
    it('applies the role in force when the second request arrives', async () => {
      const joined = await joinAs(env.app, env.database, env.owner, env.organization.id, 'editor');
      const workflowId = await publishedWorkflow(env, amountDefinition());
      const change = (role: Role) =>
        api(env)
          .patch(`/api/v1/organizations/${env.organization.id}/members/${joined.membershipId}`)
          .set(authHeaders(env.owner))
          .send({ role });

      const first = await startRun(env, joined.session, workflowId).expect(202);
      await waitForTerminal(env, env.owner, RunSchema.parse(first.body).id);

      await change('viewer').expect(200);
      await startRun(env, joined.session, workflowId).expect(403);

      await change('editor').expect(200);
      const third = await startRun(env, joined.session, workflowId).expect(202);
      await waitForTerminal(env, env.owner, RunSchema.parse(third.body).id);
    });
  });
});

/**
 * FR-008: a route of `RunsController` that changes state must declare its roles, or sit in a
 * closed, commented list. Adding a route without a decision fails here (ADR-0053 was an omission).
 */
describe('RunsController declares a role on every state-changing route (FR-008)', () => {
  /** Routes that change state and are open to any member on purpose. Empty since ADR-0082. */
  const OPEN_ON_PURPOSE: readonly string[] = [];

  const prototype = RunsController.prototype as unknown as Record<string, unknown>;
  const handlers = Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor' && typeof prototype[name] === 'function')
    .map((name) => {
      const handler = prototype[name] as object;
      return {
        name,
        method: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined,
        roles: Reflect.getMetadata(REQUIRED_ROLES, handler) as Role[] | undefined,
      };
    })
    .filter((entry) => entry.method !== undefined);

  const changing = handlers.filter((entry) => entry.method !== RequestMethod.GET);

  it('finds the three routes that start effects, so the check cannot pass empty', () => {
    expect(changing.map((entry) => entry.name).sort()).toEqual(['cancel', 'rerun', 'start']);
  });

  it.each(changing.map((entry) => [entry.name, entry] as const))(
    '%s declares owner and editor only',
    (_name, entry) => {
      if (OPEN_ON_PURPOSE.includes(entry.name)) return;
      expect(entry.roles, `${entry.name} has no @RequiredRoles`).toBeDefined();
      expect([...(entry.roles ?? [])].sort()).toEqual(['editor', 'owner']);
    },
  );

  it('keeps the reads open to every member', () => {
    for (const entry of handlers.filter((h) => h.method === RequestMethod.GET)) {
      expect(entry.roles, `${entry.name} is a read`).toBeUndefined();
    }
  });
});
