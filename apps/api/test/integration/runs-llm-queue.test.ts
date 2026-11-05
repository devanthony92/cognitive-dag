import type { Client } from '@temporalio/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RunSchema } from '@cognitive-dag/contracts';
import { TEMPORAL_CLIENT } from '../../src/temporal/temporal.module';
import { authHeaders } from './identity-helpers';
import {
  amountDefinition,
  api,
  closeRunsEnv,
  publishedWorkflow,
  runPath,
  setupRunsEnv,
  startRun,
  waitForTerminal,
  type RunsEnv,
} from './runs-helpers';

// The workflow cannot read the environment, so the API must hand it the LLM task queue (F5, R6).
describe('llmTaskQueue in the workflow input (requires docker compose up and pnpm db:migrate)', () => {
  const CUSTOM_QUEUE = 'custom-llm-queue';
  let env: RunsEnv;

  beforeAll(async () => {
    env = await setupRunsEnv({ TEMPORAL_LLM_TASK_QUEUE: CUSTOM_QUEUE });
  });

  afterAll(async () => {
    await closeRunsEnv(env);
  });

  it('passes TEMPORAL_LLM_TASK_QUEUE when it starts and when it reruns', async () => {
    const client = env.app.get<Client>(TEMPORAL_CLIENT);
    const spy = vi.spyOn(client.workflow, 'start');
    const workflowId = await publishedWorkflow(env, amountDefinition());

    const run = RunSchema.parse((await startRun(env, env.owner, workflowId).expect(202)).body);
    await waitForTerminal(env, env.owner, run.id);
    const again = RunSchema.parse(
      (
        await api(env)
          .post(`${runPath(env.organization.id, run.id)}/rerun`)
          .set(authHeaders(env.owner))
          .send({ fromNodeId: 'work' })
          .expect(202)
      ).body,
    );
    await waitForTerminal(env, env.owner, again.id);

    const inputs = spy.mock.calls.map(
      ([, options]) => (options.args as { llmTaskQueue?: string }[])[0],
    );
    expect(inputs).toHaveLength(2);
    expect(inputs.map((input) => input?.llmTaskQueue)).toEqual([CUSTOM_QUEUE, CUSTOM_QUEUE]);
    spy.mockRestore();
  });
});
