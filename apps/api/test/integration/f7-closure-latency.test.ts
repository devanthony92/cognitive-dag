import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetRateLimits } from './identity-helpers';
import {
  closeTriggersEnv,
  generateWebhook,
  postHook,
  publishedWorkflow,
  setupTriggersEnv,
  webhookDefinition,
  type TriggersEnv,
} from './triggers-helpers';
import { setLimitsAsOperator } from './workflows-helpers';

/**
 * SC-005 (T065): a valid webhook answers 202 in under 500 ms (p95, local environment).
 * No worker runs in this process: it would share the event loop with the API and the number would
 * measure the test harness, not the endpoint, which only queues the workflow.
 */
let env: TriggersEnv;

beforeAll(async () => {
  env = await setupTriggersEnv({}, { withWorker: false });
  // Runs stay queued with no worker: lift the concurrency limit so it does not answer 429.
  await setLimitsAsOperator(env.organization.id, {
    maxNodes: 50,
    maxEdges: 100,
    maxDefinitionBytes: 262_144,
    maxConcurrentRuns: 100,
  });
}, 120_000);

afterAll(async () => {
  await closeTriggersEnv(env);
});

describe('SC-005: a valid webhook answers 202 fast', () => {
  it('has a p95 under 500 ms over 40 sequential calls', async () => {
    await resetRateLimits();
    const workflow = await publishedWorkflow(env, webhookDefinition([], 50));
    const hook = await generateWebhook(env, workflow.id);
    await postHook(env, hook.path).expect(202); // warm-up: connections, plan cache
    const times: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      const started = performance.now();
      await postHook(env, hook.path).expect(202);
      times.push(performance.now() - started);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(times.length * 0.95) - 1]!;
    console.info(
      `SC-005 webhook 202 latency: p95=${p95.toFixed(0)} ms, max=${times.at(-1)!.toFixed(0)} ms`,
    );
    expect(p95).toBeLessThan(500);
  }, 90_000);
});
