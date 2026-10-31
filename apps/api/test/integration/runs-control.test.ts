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
import { uniqueTaskQueue, waitFor } from './ping-helpers';
import { SecurityEventLogger } from '../../src/security-events/security-event.logger';
import { publish, saveDraft } from './workflows-helpers';
import {
  amountDefinition,
  api,
  closeRunsEnv,
  getRun,
  publishedWorkflow,
  RUN_FLAGS,
  runPath,
  setupRunsEnv,
  slowDefinition,
  startRun,
  waitForStatus,
  waitForTerminal,
  type RunsEnv,
} from './runs-helpers';

describe('cancel and rerun (requires docker compose up and pnpm db:migrate)', () => {
  let env: RunsEnv;
  // An API whose task queue has no worker: the runs it starts stay queued. It lives as long as the
  // main app because closing an app tears down the shared CLS hooks of the others.
  let idle: INestApplication;

  beforeAll(async () => {
    env = await setupRunsEnv();
    idle = await startTestApp({ FEATURE_FLAGS: RUN_FLAGS, TEMPORAL_TASK_QUEUE: uniqueTaskQueue() });
  });

  afterAll(async () => {
    await closeRunsEnv(env);
    await idle.close();
  });

  const cancel = (runId: string, session = env.owner, organizationId = env.organization.id) =>
    api(env)
      .post(`${runPath(organizationId, runId)}/cancel`)
      .set(authHeaders(session));
  const rerun = (runId: string, session = env.owner, organizationId = env.organization.id) =>
    api(env)
      .post(`${runPath(organizationId, runId)}/rerun`)
      .set(authHeaders(session));

  async function runOf(definition: unknown, input = { monto: 150, nota: 'hola' }) {
    const workflowId = await publishedWorkflow(env, definition);
    const run = RunSchema.parse(
      (await startRun(env, env.owner, workflowId, input).expect(202)).body,
    );
    return { workflowId, run };
  }

  it('cancels a run in progress: the run and its running node end cancelled', async () => {
    const emit = vi.spyOn(env.app.get(SecurityEventLogger), 'emit');
    const { run } = await runOf(slowDefinition());
    await waitFor(async () => {
      const detail = await getRun(env, env.owner, run.id);
      return detail.steps.some((step) => step.nodeId === 'work' && step.status === 'running')
        ? detail
        : undefined;
    });

    await cancel(run.id, env.viewer).expect(202);
    const done = await waitForTerminal(env, env.owner, run.id);
    expect(done.status).toBe('cancelled');
    expect(done.steps.find((step) => step.nodeId === 'work')?.status).toBe('cancelled');

    const cancelledBy = await waitFor(async () => {
      const rows = await env.database.withContext(
        { userId: env.owner.body.user.id, organizationId: env.organization.id },
        (tx) =>
          tx.execute<{ cancelled_by: string | null }>(
            sql`SELECT cancelled_by FROM workflow_runs WHERE id = ${run.id}`,
          ),
      );
      return rows.rows[0]?.cancelled_by ?? undefined;
    });
    expect(cancelledBy).toBe(env.viewer.body.user.id);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'run.cancelled',
        outcome: 'success',
        userId: env.viewer.body.user.id,
        organizationId: env.organization.id,
      }),
    );
    emit.mockRestore();
  });

  it('cancels a run that has not started yet (no worker took it)', async () => {
    {
      const workflowId = await publishedWorkflow(env, amountDefinition());
      const started = await api({ app: idle })
        .post(`/api/v1/organizations/${env.organization.id}/workflows/${workflowId}/runs`)
        .set(authHeaders(env.owner))
        .send({ input: { monto: 1, nota: 'x' } })
        .expect(202);
      const run = RunSchema.parse(started.body);
      expect(run.status).toBe('queued');

      await api({ app: idle })
        .post(`${runPath(env.organization.id, run.id)}/cancel`)
        .set(authHeaders(env.owner))
        .expect(202);
      const detail = await getRun(env, env.owner, run.id);
      expect(detail.status).toBe('cancelled');
      expect(detail.finishedAt).not.toBeNull();
    }
  });

  it('409 RUN_NOT_CANCELLABLE when the run already finished', async () => {
    const { run } = await runOf(amountDefinition());
    await waitForTerminal(env, env.owner, run.id);
    const response = await cancel(run.id).expect(409);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('RUN_NOT_CANCELLABLE');
  });

  it('reruns a finished run: same input, active version, linked to the original', async () => {
    const emit = vi.spyOn(env.app.get(SecurityEventLogger), 'emit');
    const { workflowId, run } = await runOf(amountDefinition(), { monto: 42, nota: 'otra vez' });
    await waitForTerminal(env, env.owner, run.id);

    // Publish a second version: a rerun uses the version active now.
    const saved = await saveDraft(env, env.owner, workflowId, 2, amountDefinition(150)).expect(200);
    await publish(env, env.owner, workflowId, (saved.body as { revision: number }).revision).expect(
      201,
    );

    const response = await rerun(run.id, env.viewer).expect(202);
    const again = RunSchema.parse(response.body);
    expect(again).toMatchObject({ rerunOf: run.id, versionNumber: 2, workflowId });
    expect(again.id).not.toBe(run.id);
    const done = await waitForTerminal(env, env.owner, again.id);
    expect(done.status).toBe('succeeded');

    const io = await api(env)
      .get(`${runPath(env.organization.id, again.id)}/steps/trigger/io`)
      .set('Cookie', env.owner.cookie)
      .expect(200);
    expect(StepIoSchema.parse(io.body).input).toEqual({ monto: 42, nota: 'otra vez' });
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'run.rerun', outcome: 'success' }),
    );
    emit.mockRestore();
  });

  it('410 RUN_INPUT_EXPIRED when the Temporal history is gone', async () => {
    const { run } = await runOf(amountDefinition());
    await waitForTerminal(env, env.owner, run.id);
    await env.database.withContext(
      { userId: env.owner.body.user.id, organizationId: env.organization.id },
      (tx) =>
        tx.execute(sql`UPDATE workflow_runs
          SET temporal_workflow_id = ${temporalWorkflowIdFor(randomUUID())}
          WHERE id = ${run.id}`),
    );
    const response = await rerun(run.id).expect(410);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('RUN_INPUT_EXPIRED');
  });

  it('409 WORKFLOW_NOT_RUNNABLE when the workflow was archived since', async () => {
    const { workflowId, run } = await runOf(amountDefinition());
    await waitForTerminal(env, env.owner, run.id);
    await api(env)
      .delete(`/api/v1/organizations/${env.organization.id}/workflows/${workflowId}`)
      .set(authHeaders(env.owner))
      .expect(204);
    const response = await rerun(run.id).expect(409);
    expect(ProblemDetailsSchema.parse(response.body)).toMatchObject({
      code: 'WORKFLOW_NOT_RUNNABLE',
      reason: 'archived',
    });
  });

  it('404 on cancel and rerun for another organization, and for an unknown run', async () => {
    const { run } = await runOf(slowDefinition());
    await waitForStatus(env, env.owner, run.id, 'running');
    await cancel(run.id, env.outsider).expect(404);
    await rerun(run.id, env.outsider).expect(404);
    await cancel(run.id, env.outsider, env.outsiderOrganization.id).expect(404);
    await cancel('018f0000-0000-7000-8000-000000000000').expect(404);
    expect((await getRun(env, env.owner, run.id)).status).toBe('running');
    await cancel(run.id).expect(202);
  });

  it('emits run.started with who and where', async () => {
    const emit = vi.spyOn(env.app.get(SecurityEventLogger), 'emit');
    const { run } = await runOf(amountDefinition());
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'run.started',
        outcome: 'success',
        userId: env.owner.body.user.id,
        organizationId: env.organization.id,
      }),
    );
    await waitForTerminal(env, env.owner, run.id);
    emit.mockRestore();
  });
});
