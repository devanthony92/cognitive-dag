import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  OrganizationRunListSchema,
  ProblemDetailsSchema,
  RunSchema,
} from '@cognitive-dag/contracts';
import { startTestApp } from './helpers';
import {
  amountDefinition,
  api,
  chainDefinition,
  closeRunsEnv,
  publishedWorkflow,
  RUN_FLAGS_WITHOUT_RESILIENCE,
  setupRunsEnv,
  startRun,
  waitForTerminal,
  type RunsEnv,
} from './runs-helpers';

describe('organization runs (requires docker compose up and pnpm db:migrate)', () => {
  let env: RunsEnv;
  let withoutResilience: INestApplication;
  let okWorkflow: string;
  let failingWorkflow: string;
  const runIds: { ok: string[]; failed: string[] } = { ok: [], failed: [] };

  beforeAll(async () => {
    env = await setupRunsEnv();
    withoutResilience = await startTestApp({
      FEATURE_FLAGS: RUN_FLAGS_WITHOUT_RESILIENCE,
      TEMPORAL_TASK_QUEUE: env.taskQueue,
    });
    okWorkflow = await publishedWorkflow(env, amountDefinition(0));
    failingWorkflow = await publishedWorkflow(env, chainDefinition(true));
    for (const [workflowId, bucket] of [
      [okWorkflow, runIds.ok],
      [okWorkflow, runIds.ok],
      [failingWorkflow, runIds.failed],
    ] as const) {
      const run = RunSchema.parse((await startRun(env, env.owner, workflowId).expect(202)).body);
      await waitForTerminal(env, env.owner, run.id);
      bucket.push(run.id);
    }
  });

  afterAll(async () => {
    await closeRunsEnv(env);
    await withoutResilience.close();
  });

  const list = (query = '', session = env.owner, organizationId = env.organization.id) =>
    api(env)
      .get(`/api/v1/organizations/${organizationId}/runs${query}`)
      .set('Cookie', session.cookie);

  it('lists the runs of the organization, the most recent first, with workflow and failed node', async () => {
    const page = OrganizationRunListSchema.parse((await list('?limit=50').expect(200)).body);
    const ids = page.items.map((item) => item.id);
    expect(ids.slice(0, 3)).toEqual([runIds.failed[0], runIds.ok[1], runIds.ok[0]]);
    const failed = page.items.find((item) => item.id === runIds.failed[0]);
    expect(failed).toMatchObject({
      status: 'failed',
      failedNodeId: 'c',
      error: { class: 'permanent' },
    });
    expect(failed?.workflowName).toMatch(/\S/);
    expect(page.items.find((item) => item.id === runIds.ok[0])?.failedNodeId).toBeNull();
  });

  it('filters by status and by workflow', async () => {
    const failed = OrganizationRunListSchema.parse((await list('?status=failed').expect(200)).body);
    expect(failed.items.map((item) => item.id)).toEqual(runIds.failed);

    const ofWorkflow = OrganizationRunListSchema.parse(
      (await list(`?workflowId=${okWorkflow}`).expect(200)).body,
    );
    expect(ofWorkflow.items.map((item) => item.id)).toEqual([runIds.ok[1], runIds.ok[0]]);

    const none = OrganizationRunListSchema.parse(
      (await list(`?workflowId=${okWorkflow}&status=failed`).expect(200)).body,
    );
    expect(none.items).toEqual([]);
  });

  it('paginates with a cursor', async () => {
    const first = OrganizationRunListSchema.parse(
      (await list(`?workflowId=${okWorkflow}&limit=1`).expect(200)).body,
    );
    expect(first.items.map((item) => item.id)).toEqual([runIds.ok[1]]);
    expect(first.nextCursor).not.toBeNull();
    const second = OrganizationRunListSchema.parse(
      (
        await list(
          `?workflowId=${okWorkflow}&limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`,
        ).expect(200)
      ).body,
    );
    expect(second.items.map((item) => item.id)).toEqual([runIds.ok[0]]);
    expect(second.nextCursor).toBeNull();
  });

  it.each([
    ['an unknown status', '?status=exploded'],
    ['a malformed workflow id', '?workflowId=nope'],
    ['a limit over 50', '?limit=51'],
    ['a malformed cursor', '?cursor=%25%25'],
  ])('422 VALIDATION_FAILED for %s', async (_name, query) => {
    const response = await list(query).expect(422);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('VALIDATION_FAILED');
  });

  it('shows nothing of another organization, and 404 to those who are not members', async () => {
    const own = OrganizationRunListSchema.parse(
      (await list('', env.outsider, env.outsiderOrganization.id).expect(200)).body,
    );
    expect(own.items).toEqual([]);
    await list('', env.outsider).expect(404);
  });

  it('any role may read it', async () => {
    await list('', env.viewer).expect(200);
  });

  it('404 FEATURE_NOT_AVAILABLE with resilience-enabled off', async () => {
    const response = await api({ app: withoutResilience })
      .get(`/api/v1/organizations/${env.organization.id}/runs`)
      .set('Cookie', env.owner.cookie)
      .expect(404);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('FEATURE_NOT_AVAILABLE');
  });
});
