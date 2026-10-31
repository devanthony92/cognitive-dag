import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ProblemDetailsSchema,
  RunSchema,
  StepIoSchema,
  temporalWorkflowIdFor,
} from '@cognitive-dag/contracts';
import { sql } from '@cognitive-dag/db';
import { authHeaders } from './identity-helpers';
import { startTestApp } from './helpers';
import { SecurityEventLogger } from '../../src/security-events/security-event.logger';
import { publish, saveDraft } from './workflows-helpers';
import {
  api,
  chainDefinition,
  closeRunsEnv,
  publishedWorkflow,
  RUN_FLAGS_WITHOUT_RESILIENCE,
  runPath,
  setupRunsEnv,
  slowDefinition,
  startRun,
  waitForStatus,
  waitForTerminal,
  type RunsEnv,
} from './runs-helpers';

describe('rerun from a node (requires docker compose up and pnpm db:migrate)', () => {
  let env: RunsEnv;
  // Same database and task queue, F4 recovery off. It lives as long as the main app because
  // closing an app tears down the shared CLS hooks of the others.
  let withoutResilience: INestApplication;

  beforeAll(async () => {
    env = await setupRunsEnv();
    withoutResilience = await startTestApp({
      FEATURE_FLAGS: RUN_FLAGS_WITHOUT_RESILIENCE,
      TEMPORAL_TASK_QUEUE: env.taskQueue,
    });
  });

  afterAll(async () => {
    await closeRunsEnv(env);
    await withoutResilience.close();
  });

  const rerunFrom = (
    runId: string,
    fromNodeId: unknown,
    session = env.owner,
    organizationId = env.organization.id,
    target: Pick<RunsEnv, 'app'> = env,
  ) =>
    api(target)
      .post(`${runPath(organizationId, runId)}/rerun`)
      .set(authHeaders(session))
      .send({ fromNodeId });

  async function finishedChain(failC: boolean) {
    const workflowId = await publishedWorkflow(env, chainDefinition(failC));
    const run = RunSchema.parse((await startRun(env, env.owner, workflowId).expect(202)).body);
    const done = await waitForTerminal(env, env.owner, run.id);
    return { workflowId, run, done };
  }

  const statusesOf = (steps: { nodeId: string; status: string }[]) =>
    Object.fromEntries(steps.map((step) => [step.nodeId, step.status]));

  it('reuses the successful services before the node, on the version of the original', async () => {
    const emit = vi.spyOn(env.app.get(SecurityEventLogger), 'emit');
    const { workflowId, run, done } = await finishedChain(true);
    expect(done.status).toBe('failed');

    // A newer active version must not be used: the reused outputs belong to the original one.
    const saved = await saveDraft(env, env.owner, workflowId, 2, chainDefinition(false)).expect(
      200,
    );
    await publish(env, env.owner, workflowId, (saved.body as { revision: number }).revision).expect(
      201,
    );

    const response = await rerunFrom(run.id, 'c', env.viewer).expect(202);
    const again = RunSchema.parse(response.body);
    expect(again).toMatchObject({
      rerunOf: run.id,
      rerunFromNodeId: 'c',
      versionNumber: 1,
      workflowId,
    });

    const result = await waitForTerminal(env, env.owner, again.id);
    // Version 1 still fails at c: a permanent failure is repeated, not hidden.
    expect(result.status).toBe('failed');
    expect(statusesOf(result.steps)).toEqual({
      trigger: 'succeeded',
      a: 'reused',
      b: 'reused',
      c: 'failed',
    });
    expect(result.steps.find((step) => step.nodeId === 'a')?.attempts).toBe(0);

    const io = await api(env)
      .get(`${runPath(env.organization.id, again.id)}/steps/trigger/io`)
      .set('Cookie', env.owner.cookie)
      .expect(200);
    expect(StepIoSchema.parse(io.body).input).toEqual({ monto: 150, nota: 'hola' });

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'run.rerun', outcome: 'success', nodeId: 'c' }),
    );
    emit.mockRestore();
  });

  it('runs again the node and everything that depends on it', async () => {
    const { run } = await finishedChain(false);
    const again = RunSchema.parse((await rerunFrom(run.id, 'b').expect(202)).body);
    const result = await waitForTerminal(env, env.owner, again.id);
    expect(result.status).toBe('succeeded');
    expect(statusesOf(result.steps)).toEqual({
      trigger: 'succeeded',
      a: 'reused',
      b: 'succeeded',
      c: 'succeeded',
    });
  });

  it('can start from the trigger: nothing is reused', async () => {
    const { run } = await finishedChain(false);
    const again = RunSchema.parse((await rerunFrom(run.id, 'trigger').expect(202)).body);
    const result = await waitForTerminal(env, env.owner, again.id);
    expect(new Set(result.steps.map((step) => step.status))).toEqual(new Set(['succeeded']));
  });

  it('a rerun of a rerun still reuses what the first one reused', async () => {
    const { run } = await finishedChain(false);
    const first = RunSchema.parse((await rerunFrom(run.id, 'c').expect(202)).body);
    await waitForTerminal(env, env.owner, first.id);
    const second = RunSchema.parse((await rerunFrom(first.id, 'c').expect(202)).body);
    const result = await waitForTerminal(env, env.owner, second.id);
    expect(statusesOf(result.steps)).toMatchObject({ a: 'reused', b: 'reused', c: 'succeeded' });
  });

  it('422 RERUN_NODE_INVALID for a node the version does not have', async () => {
    const { run } = await finishedChain(false);
    const response = await rerunFrom(run.id, 'nope').expect(422);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('RERUN_NODE_INVALID');
  });

  it('422 VALIDATION_FAILED for a malformed node id', async () => {
    const { run } = await finishedChain(false);
    const response = await rerunFrom(run.id, 'Not A Node').expect(422);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('VALIDATION_FAILED');
  });

  it('409 RUN_NOT_FINISHED while the run is in progress', async () => {
    const workflowId = await publishedWorkflow(env, slowDefinition());
    const run = RunSchema.parse((await startRun(env, env.owner, workflowId).expect(202)).body);
    await waitForStatus(env, env.owner, run.id, 'running');
    const response = await rerunFrom(run.id, 'work').expect(409);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('RUN_NOT_FINISHED');
    await api(env)
      .post(`${runPath(env.organization.id, run.id)}/cancel`)
      .set(authHeaders(env.owner))
      .expect(202);
  });

  it('410 RUN_INPUT_EXPIRED when the history is gone', async () => {
    const { run } = await finishedChain(false);
    await env.database.withContext(
      { userId: env.owner.body.user.id, organizationId: env.organization.id },
      (tx) =>
        tx.execute(sql`UPDATE workflow_runs
          SET temporal_workflow_id = ${temporalWorkflowIdFor(randomUUID())}
          WHERE id = ${run.id}`),
    );
    const response = await rerunFrom(run.id, 'c').expect(410);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('RUN_INPUT_EXPIRED');
  });

  it('404 for another organization and for an unknown run', async () => {
    const { run } = await finishedChain(false);
    await rerunFrom(run.id, 'c', env.outsider).expect(404);
    await rerunFrom('018f0000-0000-7000-8000-000000000000', 'c').expect(404);
  });

  it('404 FEATURE_NOT_AVAILABLE for fromNodeId with resilience-enabled off; a plain rerun works', async () => {
    const { run } = await finishedChain(false);
    const blocked = await rerunFrom(run.id, 'c', env.owner, env.organization.id, {
      app: withoutResilience,
    }).expect(404);
    expect(ProblemDetailsSchema.parse(blocked.body).code).toBe('FEATURE_NOT_AVAILABLE');

    await api({ app: withoutResilience })
      .post(`${runPath(env.organization.id, run.id)}/rerun`)
      .set(authHeaders(env.owner))
      .expect(202);
  });
});
