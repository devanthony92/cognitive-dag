import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RunSchema } from '@cognitive-dag/contracts';
import { authHeaders } from './identity-helpers';
import {
  api,
  closeRunsEnv,
  publishedWorkflow,
  setupRunsEnv,
  startRun,
  unsupportedDefinition,
  type RunsEnv,
} from './runs-helpers';

const usagePath = (organizationId: string) =>
  `/api/v1/organizations/${organizationId}/llm-usage/today`;

describe('LLM nodes (requires docker compose up and pnpm db:migrate)', () => {
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
