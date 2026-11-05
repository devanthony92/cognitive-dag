import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LlmDailyUsageSchema,
  ProblemDetailsSchema,
  RunDetailSchema,
  RunSchema,
} from '@cognitive-dag/contracts';
import { llmCalls, llmUsageDaily } from '@cognitive-dag/db';
import { authHeaders } from './identity-helpers';
import {
  amountDefinition,
  api,
  closeRunsEnv,
  publishedWorkflow,
  setupRunsEnv,
  startRun,
  waitForTerminal,
  type RunsEnv,
} from './runs-helpers';
import { freshOrganization } from './workflows-helpers';

const usagePath = (organizationId: string) =>
  `/api/v1/organizations/${organizationId}/llm-usage/today`;
const today = () => new Date().toISOString().slice(0, 10);

describe('LLM usage (requires docker compose up and pnpm db:migrate)', () => {
  let env: RunsEnv;

  beforeAll(async () => {
    env = await setupRunsEnv({ LLM_MAX_TOKENS_PER_ORG_DAY: 1000 });
  });
  afterAll(async () => {
    await closeRunsEnv(env);
  });

  it('shows zeros and the limit when the organization has not used any today', async () => {
    const fresh = await freshOrganization(env);
    const response = await api(env)
      .get(usagePath(fresh.organizationId))
      .set(authHeaders(fresh.session))
      .expect(200);
    expect(LlmDailyUsageSchema.parse(response.body)).toEqual({
      date: today(),
      tokensUsed: 0,
      tokensLimit: 1000,
      costMicroUsd: 0,
    });
  });

  it('shows the counter of the UTC day, ignoring other days', async () => {
    const fresh = await freshOrganization(env);
    const organizationId = fresh.organizationId;
    await env.database.withContext(
      { userId: fresh.session.body.user.id, organizationId },
      async (tx) => {
        await tx.insert(llmUsageDaily).values([
          { organizationId, usageDate: today(), tokensUsed: 420, costMicroUsd: 1500 },
          { organizationId, usageDate: '2020-01-01', tokensUsed: 999, costMicroUsd: 9 },
        ]);
      },
    );
    const response = await api(env)
      .get(usagePath(organizationId))
      .set(authHeaders(fresh.session))
      .expect(200);
    expect(response.body).toEqual({
      date: today(),
      tokensUsed: 420,
      tokensLimit: 1000,
      costMicroUsd: 1500,
    });
  });

  it('404 for an organization the caller does not belong to', async () => {
    const response = await api(env)
      .get(usagePath(env.outsiderOrganization.id))
      .set(authHeaders(env.owner))
      .expect(404);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('NOT_FOUND');
  });

  it('adds llm_calls into llmUsage per step and for the run', async () => {
    const workflowId = await publishedWorkflow(env, amountDefinition(0));
    const started = RunSchema.parse((await startRun(env, env.owner, workflowId).expect(202)).body);
    const before = await waitForTerminal(env, env.owner, started.id);
    // Without any call, nothing is reported.
    expect(RunDetailSchema.parse(before).llmUsage ?? null).toBeNull();

    const base = {
      organizationId: env.organization.id,
      runId: started.id,
      nodeId: 'work',
      nodeType: 'llm.generate',
      model: 'm-a',
      reservedTokens: 100,
      durationMs: 5,
    };
    await env.database.withContext(
      { userId: env.owner.body.user.id, organizationId: env.organization.id },
      async (tx) => {
        await tx.insert(llmCalls).values([
          {
            ...base,
            attempt: 1,
            inputTokens: 10,
            outputTokens: 5,
            costMicroUsd: 100,
            outcome: 'invalid_output',
            errorCode: 'LLM_INVALID_OUTPUT',
            repairs: 1,
          },
          {
            ...base,
            attempt: 2,
            inputTokens: 20,
            outputTokens: 7,
            costMicroUsd: 250,
            outcome: 'succeeded',
          },
        ]);
      },
    );

    const detail = RunDetailSchema.parse(await waitForTerminal(env, env.owner, started.id));
    expect(detail.llmUsage).toEqual({
      calls: 2,
      inputTokens: 30,
      outputTokens: 12,
      costMicroUsd: 350,
      repairs: 1,
    });
    const step = detail.steps.find((item) => item.nodeId === 'work');
    expect(step?.llmUsage).toEqual({
      calls: 2,
      model: 'm-a',
      inputTokens: 30,
      outputTokens: 12,
      costMicroUsd: 350,
      repairs: 1,
    });
    expect(detail.steps.find((item) => item.nodeId === 'trigger')?.llmUsage ?? null).toBeNull();
  });
});
