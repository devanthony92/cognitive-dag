import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RunSchema, StepIoSchema } from '@cognitive-dag/contracts';
import { llmCalls, sql } from '@cognitive-dag/db';
import { authHeaders } from './identity-helpers';
import {
  api,
  classifyDefinition,
  closeRunsEnv,
  publishedWorkflow,
  runPath,
  setupRunsEnv,
  startRun,
  waitForTerminal,
  type RunsEnv,
} from './runs-helpers';

describe('LLM step content from the Temporal history (requires docker compose up)', () => {
  let env: RunsEnv;

  beforeAll(async () => {
    env = await setupRunsEnv({}, { llm: true });
  });

  afterAll(async () => {
    await closeRunsEnv(env);
  });

  const callCount = (runId: string): Promise<number> =>
    env.database.withContext(
      { userId: env.owner.body.user.id, organizationId: env.organization.id },
      async (tx) => {
        const rows = await tx
          .select({ id: llmCalls.id })
          .from(llmCalls)
          .where(sql`run_id = ${runId}`);
        return rows.length;
      },
    );

  it('returns the label and confidence of a classify step, with only its config as input', async () => {
    const workflowId = await publishedWorkflow(env, classifyDefinition());
    const run = RunSchema.parse((await startRun(env, env.owner, workflowId).expect(202)).body);
    const done = await waitForTerminal(env, env.owner, run.id);
    expect(done.status).toBe('succeeded');

    const response = await api(env)
      .get(`${runPath(env.organization.id, run.id)}/steps/classify/io`)
      .set('Cookie', env.viewer.cookie)
      .expect(200);
    const io = StepIoSchema.parse(response.body);
    expect(io.output).toMatchObject({
      label: expect.any(String) as string,
      confidence: expect.any(Number) as number,
    });
    expect(Object.keys(io.input as object)).toEqual(['config']);
  });

  it('reruns from a service after classify reusing it, without new tokens', async () => {
    const workflowId = await publishedWorkflow(env, classifyDefinition());
    const run = RunSchema.parse((await startRun(env, env.owner, workflowId).expect(202)).body);
    await waitForTerminal(env, env.owner, run.id);
    expect(await callCount(run.id)).toBeGreaterThan(0);

    const again = RunSchema.parse(
      (
        await api(env)
          .post(`${runPath(env.organization.id, run.id)}/rerun`)
          .set(authHeaders(env.owner))
          .send({ fromNodeId: 'after' })
          .expect(202)
      ).body,
    );
    const result = await waitForTerminal(env, env.owner, again.id);
    expect(result.status).toBe('succeeded');
    expect(Object.fromEntries(result.steps.map((step) => [step.nodeId, step.status]))).toEqual({
      trigger: 'succeeded',
      classify: 'reused',
      after: 'succeeded',
    });
    expect(await callCount(again.id)).toBe(0);
  });
});
