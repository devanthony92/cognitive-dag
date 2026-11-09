import { randomUUID } from 'node:crypto';
import { MockActivityEnvironment } from '@temporalio/testing';
import { describe, expect, it } from 'vitest';
import { FakeProvider } from '@cognitive-dag/llm';
import { createLogger } from '@cognitive-dag/logger';
import { parseEnv } from '../../src/config/env.schema';
import { createLlmActivities } from '../../src/llm/activities';
import { createScheduleActivities } from '../../src/schedules/activities';
import { MODELS, POLICY, memoryBudget } from '../helpers/llm';

/**
 * F8 removes the product flags; these three variables stay as the operator's emergency stops
 * (decision 2B). `LLM_DISABLED` for the compiler and `HTTP_DISABLED` for the HTTP node are pinned
 * in compile-intent.workflow.test.ts and http-activity.test.ts.
 */
const logger = createLogger({ component: 'worker-test', level: 'silent' });
const BASE_ENV = {
  TEMPORAL_ADDRESS: '127.0.0.1:7233',
  TEMPORAL_TASK_QUEUE: 'cognitive-dag',
  DATABASE_URL: 'postgres://app_runtime:secret-pw@127.0.0.1:5433/cognitive_dag',
  VALKEY_URL: 'redis://127.0.0.1:6379',
};

describe('kill switches of the worker', () => {
  it.each(['LLM_ENABLED', 'HTTP_ENABLED', 'TRIGGERS_ENABLED'] as const)(
    '%s defaults to on and turns off with "false"',
    (name) => {
      expect(parseEnv(BASE_ENV)[name]).toBe(true);
      expect(parseEnv({ ...BASE_ENV, [name]: 'false' })[name]).toBe(false);
    },
  );

  it('LLM_ENABLED=false fails LLM_DISABLED without calling the provider', async () => {
    const provider = new FakeProvider();
    const memory = memoryBudget();
    const activities = createLlmActivities({
      logger,
      provider,
      budget: memory.budget,
      enabled: false,
      models: MODELS,
      prices: new Map([['test-lite', { input: 100_000, output: 400_000 }]]),
      maxInputChars: 1000,
    });
    await expect(
      new MockActivityEnvironment({ attempt: 1 }).run(activities.llmClassify, {
        runId: randomUUID(),
        nodeId: 'ai',
        correlationId: randomUUID(),
        organizationId: randomUUID(),
        policy: POLICY,
        config: { text: 'hola', labels: ['a', 'b'], redactPii: false },
      }),
    ).rejects.toMatchObject({ type: 'LLM_DISABLED', nonRetryable: true });
    expect(provider.calls).toHaveLength(0);
    expect(memory.reserved).toHaveLength(0);
  });

  it('TRIGGERS_ENABLED=false skips the firing before touching the database', async () => {
    const activities = createScheduleActivities({
      withContext: () => {
        throw new Error('the firing must not reach the database');
      },
      logger,
      triggersOn: false,
      llmEnabled: false,
      llmTaskQueue: 'llm-q',
      httpTaskQueue: 'http-q',
    });
    const result = await activities.startScheduledRun({
      organizationId: randomUUID(),
      workflowId: randomUUID(),
      correlationId: randomUUID(),
      scheduledAt: new Date().toISOString(),
    });
    expect(result).toEqual({ status: 'skipped', reason: 'triggers_disabled' });
  });
});
