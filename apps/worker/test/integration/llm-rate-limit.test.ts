import { randomUUID } from 'node:crypto';
import { MockActivityEnvironment } from '@temporalio/testing';
import Valkey from 'iovalkey';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeProvider } from '@cognitive-dag/llm';
import { createLogger } from '@cognitive-dag/logger';
import { parseEnv } from '../../src/config/env.schema';
import { loadLocalEnv } from '../../src/config/load-env';
import { createLlmActivities, type LlmNodeInput } from '../../src/llm/activities';
import {
  createModelRateLimiter,
  modelRateLimitKey,
  type ModelRateLimiter,
  type RateLimiter,
} from '../../src/resilience/rate-limiter';
import { MODELS, POLICY, memoryBudget } from '../helpers/llm';

loadLocalEnv();
const config = parseEnv(process.env);
const logger = createLogger({ component: 'worker-test', level: 'silent' });

describe('global rate limit per model (requires docker compose up)', () => {
  let valkey: Valkey;

  beforeAll(() => {
    valkey = new Valkey(config.VALKEY_URL);
  });

  afterAll(() => {
    valkey.disconnect();
  });

  const input = (): LlmNodeInput => ({
    runId: randomUUID(),
    nodeId: 'ai',
    correlationId: randomUUID(),
    organizationId: randomUUID(),
    policy: POLICY,
    config: { text: 'hola', labels: ['positivo', 'negativo'], redactPii: false },
  });

  it('shares one bucket per model across organizations, under rl:global:<model>', async () => {
    const model = `model-${randomUUID()}`;
    const limiter = createModelRateLimiter({
      valkey,
      limit: { capacity: 2, refillPerSecond: 0.1 },
    });
    expect(await limiter.acquire(model)).toEqual({ granted: true });
    expect(await limiter.acquire(model)).toEqual({ granted: true });
    const denied = await limiter.acquire(model);
    expect(denied.granted).toBe(false);
    expect(denied.granted === false && denied.retryAfterMs).toBeGreaterThan(0);

    expect(await valkey.exists(modelRateLimitKey(model))).toBe(1);
    expect(modelRateLimitKey(model)).toBe(`rl:global:${model}`);
    expect(await valkey.ttl(modelRateLimitKey(model))).toBeGreaterThan(0);

    // Another model has its own bucket.
    expect(await limiter.acquire(`other-${model}`)).toEqual({ granted: true });
  });

  it('asks for the organization bucket and the model bucket before reserving budget', async () => {
    const order: string[] = [];
    const rateLimiter: RateLimiter = {
      acquire: (_org, nodeType) => {
        order.push(`org:${nodeType}`);
        return Promise.resolve({ granted: true });
      },
    };
    const modelRateLimiter: ModelRateLimiter = {
      acquire: (model) => {
        order.push(`model:${model}`);
        return Promise.resolve({ granted: true });
      },
    };
    const memory = memoryBudget();
    const budget = {
      ...memory.budget,
      reserve: (request: Parameters<typeof memory.budget.reserve>[0]) => {
        order.push('reserve');
        return memory.budget.reserve(request);
      },
    };
    const activities = createLlmActivities({
      logger,
      provider: new FakeProvider(),
      budget,
      enabled: true,
      models: MODELS,
      prices: new Map(),
      maxInputChars: 1000,
      rateLimiter,
      modelRateLimiter,
    });
    await new MockActivityEnvironment().run(activities.llmClassify, input());
    expect(order).toEqual(['org:llm.classify', 'model:test-lite', 'reserve']);
  });

  it('waits for its turn without calling the provider or reserving when the model is limited', async () => {
    const model = `model-${randomUUID()}`;
    const provider = new FakeProvider();
    const memory = memoryBudget();
    const activities = createLlmActivities({
      logger,
      provider,
      budget: memory.budget,
      enabled: true,
      models: { ...MODELS, 'llm.classify': model },
      prices: new Map(),
      maxInputChars: 1000,
      modelRateLimiter: createModelRateLimiter({
        valkey,
        limit: { capacity: 1, refillPerSecond: 0.01 },
      }),
    });
    await new MockActivityEnvironment().run(activities.llmClassify, input());
    expect(provider.calls).toHaveLength(1);

    await expect(
      new MockActivityEnvironment().run(activities.llmClassify, input()),
    ).rejects.toMatchObject({
      type: 'RATE_LIMIT_EXHAUSTED',
      nonRetryable: false,
      details: [expect.objectContaining({ errorClass: 'rate_limited' })],
    });
    expect(provider.calls).toHaveLength(1);
    expect(memory.reserved).toHaveLength(1);
  });
});
