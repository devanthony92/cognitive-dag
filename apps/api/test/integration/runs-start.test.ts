import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ProblemDetailsSchema,
  RunDetailSchema,
  RunListSchema,
  RunSchema,
} from '@cognitive-dag/contracts';
import { authHeaders, startIdentityApp } from './identity-helpers';
import { uniqueTaskQueue } from './ping-helpers';
import {
  amountDefinition,
  api,
  closeRunsEnv,
  publishedWorkflow,
  runPath,
  runsPath,
  setupRunsEnv,
  startRun,
  unsupportedDefinition,
  waitForTerminal,
  type RunsEnv,
} from './runs-helpers';
import {
  createWorkflow,
  setupWorkflowsEnv,
  closeWorkflowsEnv,
  workflowsPath,
} from './workflows-helpers';

describe('start a run (requires docker compose up and pnpm db:migrate)', () => {
  let env: RunsEnv;

  beforeAll(async () => {
    env = await setupRunsEnv();
  });

  afterAll(async () => {
    await closeRunsEnv(env);
  });

  it('runs the active version and records the run until it succeeds', async () => {
    const workflowId = await publishedWorkflow(env, amountDefinition());
    const response = await startRun(env, env.owner, workflowId).expect(202);
    const run = RunSchema.parse(response.body);
    expect(response.headers['location']).toBe(runPath(env.organization.id, run.id));
    expect(run).toMatchObject({
      workflowId,
      versionNumber: 1,
      rerunOf: null,
      triggeredBy: { id: env.owner.body.user.id },
    });
    expect(['queued', 'running']).toContain(run.status);

    const done = RunDetailSchema.parse(await waitForTerminal(env, env.owner, run.id));
    expect(done.status).toBe('succeeded');
    expect(done.steps.map((step) => [step.nodeId, step.status]).sort()).toEqual([
      ['trigger', 'succeeded'],
      ['work', 'succeeded'],
    ]);
    expect(done.definition).toMatchObject({ schemaVersion: 1 });
  });

  it('any member can run, even a viewer', async () => {
    const workflowId = await publishedWorkflow(env, amountDefinition());
    for (const session of [env.viewer, env.editor]) {
      const response = await startRun(env, session, workflowId).expect(202);
      const run = RunSchema.parse(response.body);
      expect(run.triggeredBy.id).toBe(session.body.user.id);
      await waitForTerminal(env, env.owner, run.id);
    }
  });

  it('422 RUN_INPUT_INVALID when the input does not match the manual trigger', async () => {
    const workflowId = await publishedWorkflow(env, amountDefinition());
    const cases: Record<string, unknown>[] = [
      { monto: 'mucho', nota: 'x' },
      { nota: 'x' },
      { monto: 1, nota: 'x', extra: true },
    ];
    for (const input of cases) {
      const response = await startRun(env, env.owner, workflowId, input).expect(422);
      const problem = ProblemDetailsSchema.parse(response.body);
      expect(problem.code).toBe('RUN_INPUT_INVALID');
      expect(problem.errors?.length).toBeGreaterThan(0);
    }
    const list = await api(env)
      .get(runsPath(env.organization.id, workflowId))
      .set('Cookie', env.owner.cookie)
      .expect(200);
    expect(RunListSchema.parse(list.body).items).toHaveLength(0);
  });

  it('409 WORKFLOW_NOT_RUNNABLE without an active version', async () => {
    const workflow = await createWorkflow(env);
    const response = await startRun(env, env.owner, workflow.id).expect(409);
    const problem = ProblemDetailsSchema.parse(response.body);
    expect(problem).toMatchObject({ code: 'WORKFLOW_NOT_RUNNABLE', reason: 'no_active_version' });
  });

  it('409 WORKFLOW_NOT_RUNNABLE when the version has nodes of later phases', async () => {
    const workflowId = await publishedWorkflow(env, unsupportedDefinition());
    const response = await startRun(env, env.owner, workflowId, {}).expect(409);
    const problem = ProblemDetailsSchema.parse(response.body);
    expect(problem).toMatchObject({
      code: 'WORKFLOW_NOT_RUNNABLE',
      reason: 'unsupported_nodes',
      nodes: [{ nodeId: 'texto', type: 'llm.generate' }],
    });
  });

  it('409 WORKFLOW_NOT_RUNNABLE for an archived workflow', async () => {
    const workflowId = await publishedWorkflow(env, amountDefinition());
    await api(env)
      .delete(`${workflowsPath(env.organization.id)}/${workflowId}`)
      .set(authHeaders(env.owner))
      .expect(204);
    const response = await startRun(env, env.owner, workflowId).expect(409);
    expect(ProblemDetailsSchema.parse(response.body)).toMatchObject({
      code: 'WORKFLOW_NOT_RUNNABLE',
      reason: 'archived',
    });
  });

  it('404 for a workflow that does not exist', async () => {
    const response = await startRun(env, env.owner, '018f0000-0000-7000-8000-000000000000').expect(
      404,
    );
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('NOT_FOUND');
  });

  it('lists runs newest first with cursor pagination', async () => {
    const workflowId = await publishedWorkflow(env, amountDefinition());
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const response = await startRun(env, env.owner, workflowId).expect(202);
      ids.push(RunSchema.parse(response.body).id);
    }
    // Keep the organization under its limit of runs in progress for the tests that follow.
    for (const id of ids) await waitForTerminal(env, env.owner, id);
    const first = await api(env)
      .get(`${runsPath(env.organization.id, workflowId)}?limit=2`)
      .set('Cookie', env.viewer.cookie)
      .expect(200);
    const page1 = RunListSchema.parse(first.body);
    expect(page1.items.map((run) => run.id)).toEqual([ids[2], ids[1]]);
    expect(page1.nextCursor).not.toBeNull();

    const second = await api(env)
      .get(
        `${runsPath(env.organization.id, workflowId)}?limit=2&cursor=${encodeURIComponent(page1.nextCursor!)}`,
      )
      .set('Cookie', env.viewer.cookie)
      .expect(200);
    const page2 = RunListSchema.parse(second.body);
    expect(page2.items.map((run) => run.id)).toEqual([ids[0]]);
    expect(page2.nextCursor).toBeNull();

    await api(env)
      .get(`${runsPath(env.organization.id, workflowId)}?cursor=nonsense`)
      .set('Cookie', env.viewer.cookie)
      .expect(422);
  });

  it('404 on every endpoint for a member of another organization', async () => {
    const workflowId = await publishedWorkflow(env, amountDefinition());
    const run = RunSchema.parse((await startRun(env, env.owner, workflowId).expect(202)).body);
    await waitForTerminal(env, env.owner, run.id);
    const orgId = env.organization.id;

    await startRun(env, env.outsider, workflowId).expect(404);
    await api(env).get(runsPath(orgId, workflowId)).set('Cookie', env.outsider.cookie).expect(404);
    await api(env).get(runPath(orgId, run.id)).set('Cookie', env.outsider.cookie).expect(404);

    // The outsider's own organization must not see the run either.
    const own = env.outsiderOrganization.id;
    const crossed = await api(env)
      .get(runPath(own, run.id))
      .set('Cookie', env.outsider.cookie)
      .expect(404);
    expect(ProblemDetailsSchema.parse(crossed.body).code).toBe('NOT_FOUND');
    await startRun(env, env.outsider, workflowId, {}, own).expect(404);
  });

  it('401 without a session', async () => {
    await api(env).get(runPath(env.organization.id, env.organization.id)).expect(401);
  });
});

describe('start a run when Temporal fails', () => {
  let env: RunsEnv;

  beforeAll(async () => {
    // The API cannot reach Temporal: the address is a closed port.
    env = await setupRunsEnv({ TEMPORAL_ADDRESS: '127.0.0.1:1' });
  });

  afterAll(async () => {
    await closeRunsEnv(env);
  });

  it('503 and the run ends failed with SERVICE_UNAVAILABLE, never running', async () => {
    const workflowId = await publishedWorkflow(env, amountDefinition());
    const response = await startRun(env, env.owner, workflowId).expect(503);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('SERVICE_UNAVAILABLE');

    const list = await api(env)
      .get(runsPath(env.organization.id, workflowId))
      .set('Cookie', env.owner.cookie)
      .expect(200);
    const { items } = RunListSchema.parse(list.body);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      status: 'failed',
      error: { code: 'SERVICE_UNAVAILABLE' },
    });
    expect(items[0]?.finishedAt).not.toBeNull();
  }, 30_000);
});

describe('start a run with execution-enabled off', () => {
  it('404 FEATURE_NOT_AVAILABLE on the run endpoints, with the roles still enforced when on', async () => {
    const env = await setupWorkflowsEnv();
    const app = await startIdentityApp(
      '{"ping-enabled":true,"identity-enabled":true,"dag-editor-enabled":true}',
      { TEMPORAL_TASK_QUEUE: uniqueTaskQueue() },
    );
    try {
      const orgId = env.organization.id;
      const workflowId = '018f0000-0000-7000-8000-000000000000';
      for (const response of [
        await api({ app })
          .post(runsPath(orgId, workflowId))
          .set(authHeaders(env.owner))
          .send({ input: {} }),
        await api({ app }).get(runsPath(orgId, workflowId)).set('Cookie', env.owner.cookie),
        await api({ app }).get(runPath(orgId, workflowId)).set('Cookie', env.owner.cookie),
        await api({ app })
          .get(`${runPath(orgId, workflowId)}/events`)
          .set('Cookie', env.owner.cookie),
        await api({ app })
          .post(`${runPath(orgId, workflowId)}/cancel`)
          .set(authHeaders(env.owner)),
        await api({ app })
          .post(`${runPath(orgId, workflowId)}/rerun`)
          .set(authHeaders(env.owner)),
        await api({ app })
          .get(`${runPath(orgId, workflowId)}/steps/trigger/io`)
          .set('Cookie', env.owner.cookie),
      ]) {
        expect(response.status).toBe(404);
        expect(ProblemDetailsSchema.parse(response.body).code).toBe('FEATURE_NOT_AVAILABLE');
      }
    } finally {
      await app.close();
      await closeWorkflowsEnv(env);
    }
  });
});
