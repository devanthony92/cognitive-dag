import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProblemDetailsSchema, RunDetailSchema, RunSchema } from '@cognitive-dag/contracts';
import { authHeaders } from './identity-helpers';
import {
  RUN_FLAGS,
  amountDefinition,
  api,
  closeRunsEnv,
  publishedWorkflow,
  setupRunsEnv,
  startRun,
  unsupportedDefinition,
  waitForTerminal,
  type RunsEnv,
} from './runs-helpers';

const WITHOUT_LLM = RUN_FLAGS.replace(',"llm-nodes-enabled":true', '');
const usagePath = (organizationId: string) =>
  `/api/v1/organizations/${organizationId}/llm-usage/today`;

describe('llm-nodes-enabled off (requires docker compose up and pnpm db:migrate)', () => {
  let env: RunsEnv;

  beforeAll(async () => {
    env = await setupRunsEnv({ FEATURE_FLAGS: WITHOUT_LLM });
  });
  afterAll(async () => {
    await closeRunsEnv(env);
  });

  it('409 WORKFLOW_NOT_RUNNABLE for a version with LLM nodes', async () => {
    const workflowId = await publishedWorkflow(env, unsupportedDefinition());
    const response = await startRun(env, env.owner, workflowId, {}).expect(409);
    expect(ProblemDetailsSchema.parse(response.body)).toMatchObject({
      code: 'WORKFLOW_NOT_RUNNABLE',
      reason: 'unsupported_nodes',
      nodes: [{ nodeId: 'texto', type: 'llm.generate' }],
    });
  });

  it('404 FEATURE_NOT_AVAILABLE for the daily usage', async () => {
    const response = await api(env)
      .get(usagePath(env.organization.id))
      .set(authHeaders(env.owner))
      .expect(404);
    expect(ProblemDetailsSchema.parse(response.body).code).toBe('FEATURE_NOT_AVAILABLE');
  });

  it('llmUsage is null in the run detail and in its steps', async () => {
    const workflowId = await publishedWorkflow(env, amountDefinition(0));
    const started = RunSchema.parse((await startRun(env, env.owner, workflowId).expect(202)).body);
    const detail = RunDetailSchema.parse(await waitForTerminal(env, env.owner, started.id));
    expect(detail.llmUsage ?? null).toBeNull();
    for (const step of detail.steps) expect(step.llmUsage ?? null).toBeNull();
  });
});

describe('llm-nodes-enabled on', () => {
  let env: RunsEnv;

  beforeAll(async () => {
    env = await setupRunsEnv();
  });
  afterAll(async () => {
    await closeRunsEnv(env);
  });

  it('accepts a version with LLM nodes (executable phases F3 and F5)', async () => {
    const workflowId = await publishedWorkflow(env, unsupportedDefinition());
    const response = await startRun(env, env.owner, workflowId, {}).expect(202);
    expect(RunSchema.parse(response.body).status).toBe('queued');
  });

  it('serves the daily usage', async () => {
    const response = await api(env)
      .get(usagePath(env.organization.id))
      .set(authHeaders(env.owner))
      .expect(200);
    expect(response.body).toHaveProperty('tokensLimit');
  });
});
