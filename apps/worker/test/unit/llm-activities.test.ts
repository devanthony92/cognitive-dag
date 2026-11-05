import { randomUUID } from 'node:crypto';
import { MockActivityEnvironment } from '@temporalio/testing';
import { describe, expect, it } from 'vitest';
import { FakeProvider, type FakeStep } from '@cognitive-dag/llm';
import { createLogger } from '@cognitive-dag/logger';
import {
  createLlmActivities,
  type LlmActivityOptions,
  type LlmNodeInput,
  type LlmNodeResult,
} from '../../src/llm/activities';
import { MODELS, POLICY, memoryBudget } from '../helpers/llm';

const logger = createLogger({ component: 'worker-test', level: 'silent' });

const input = (config: Record<string, unknown>): LlmNodeInput => ({
  runId: randomUUID(),
  nodeId: 'ai',
  correlationId: randomUUID(),
  organizationId: randomUUID(),
  policy: POLICY,
  config,
});

const classifyConfig = (text: string, redactPii = false) => ({
  text,
  labels: ['positivo', 'negativo'],
  redactPii,
});

function setup(script?: readonly FakeStep[], overrides: Partial<LlmActivityOptions> = {}) {
  const provider = new FakeProvider(script);
  const memory = memoryBudget();
  const activities = createLlmActivities({
    logger,
    provider,
    budget: memory.budget,
    enabled: true,
    models: MODELS,
    prices: new Map([['test-lite', { input: 100_000, output: 400_000 }]]),
    maxInputChars: 1000,
    ...overrides,
  });
  const env = () => new MockActivityEnvironment({ attempt: 1 });
  return { provider, memory, activities, env };
}

describe('LLM activities', () => {
  it('classify, extract and generate return valid outputs and settle their budget', async () => {
    const { activities, env, memory, provider } = setup();
    const classified = await env().run(activities.llmClassify, input(classifyConfig('I love it')));
    expect((classified as LlmNodeResult).output).toMatchObject({ label: 'positivo' });

    const extracted = await env().run(
      activities.llmExtract,
      input({
        text: 'Order 77',
        fields: [{ name: 'order', type: { kind: 'string' } }],
        redactPii: false,
      }),
    );
    expect((extracted as LlmNodeResult).output).toEqual({ order: 'texto de ejemplo' });

    const generated = await env().run(
      activities.llmGenerate,
      input({ instruction: 'Write a greeting', language: 'es', maxLength: 200, redactPii: false }),
    );
    expect((generated as LlmNodeResult).output).toEqual({ text: 'texto de ejemplo' });

    expect(provider.calls.map((c) => c.model)).toEqual(['test-lite', 'test-lite', 'test-flash']);
    expect(memory.settled.map((c) => [c.nodeType, c.outcome, c.repairs])).toEqual([
      ['llm.classify', 'succeeded', 0],
      ['llm.extract', 'succeeded', 0],
      ['llm.generate', 'succeeded', 0],
    ]);
    // Cost is estimated from the price of the model; a model without a price costs 0.
    expect(memory.settled[0]?.costMicroUsd).toBeGreaterThan(0);
    expect(memory.settled[2]?.costMicroUsd).toBe(0);
  });

  it('records the call without any content', async () => {
    const secret = 'ZEBRA-SECRET-TEXT';
    const { activities, env, memory } = setup();
    await env().run(activities.llmClassify, input(classifyConfig(secret)));
    const record = JSON.stringify(memory.settled);
    expect(record).not.toContain(secret);
    expect(record).not.toContain('texto de ejemplo');
  });

  it('repairs an invalid answer, reserving budget again for each repair', async () => {
    const { activities, env, memory, provider } = setup([
      { text: 'not json' },
      { text: JSON.stringify({ label: 'positivo', confidence: 0.9 }) },
    ]);
    const result = await env().run(activities.llmClassify, input(classifyConfig('hola')));
    expect((result as LlmNodeResult).output).toEqual({ label: 'positivo', confidence: 0.9 });
    expect(provider.calls).toHaveLength(2);
    expect(memory.reserved).toHaveLength(2);
    expect(memory.settled).toHaveLength(1);
    expect(memory.settled[0]).toMatchObject({ repairs: 1, outcome: 'succeeded' });
    expect(memory.settled[0]?.reservedTokens).toBe(memory.reserved[0]! * 2);
  });

  it('fails invalid_output without a retry after the repairs run out', async () => {
    const { activities, env, memory, provider } = setup([
      { text: 'x' },
      { text: 'y' },
      { text: 'z' },
    ]);
    await expect(
      env().run(activities.llmClassify, input(classifyConfig('hola'))),
    ).rejects.toMatchObject({ type: 'LLM_INVALID_OUTPUT', nonRetryable: true });
    expect(provider.calls).toHaveLength(3);
    expect(memory.settled[0]).toMatchObject({
      outcome: 'invalid_output',
      errorCode: 'LLM_INVALID_OUTPUT',
      repairs: 2,
    });
  });

  it.each([
    ['empty', '   ', 'LLM_EMPTY_INPUT'],
    ['too large', 'a'.repeat(1001), 'LLM_INPUT_TOO_LARGE'],
  ])(
    'rejects an %s input as permanent, with no call and no reservation',
    async (_n, text, code) => {
      const { activities, env, memory, provider } = setup();
      await expect(
        env().run(activities.llmClassify, input(classifyConfig(text))),
      ).rejects.toMatchObject({ type: code, nonRetryable: true });
      expect(provider.calls).toHaveLength(0);
      expect(memory.reserved).toHaveLength(0);
    },
  );

  it('fails LLM_DISABLED without calling anything when the kill switch is off', async () => {
    const { activities, env, memory, provider } = setup(undefined, { enabled: false });
    await expect(
      env().run(activities.llmClassify, input(classifyConfig('hola'))),
    ).rejects.toMatchObject({ type: 'LLM_DISABLED', nonRetryable: true });
    expect(provider.calls).toHaveLength(0);
    expect(memory.reserved).toHaveLength(0);
  });

  it('masks personal data before the text leaves when redactPii is on', async () => {
    const { activities, env, provider } = setup();
    await env().run(
      activities.llmClassify,
      input(classifyConfig('Write to ana.perez@example.com please', true)),
    );
    const sent = provider.calls[0]?.user ?? '';
    expect(sent).not.toContain('ana.perez@example.com');
    expect(sent).toContain('[EMAIL_1]');
  });

  it('keeps the text as it is when redactPii is off', async () => {
    const { activities, env, provider } = setup();
    await env().run(activities.llmClassify, input(classifyConfig('Write to ana@example.com')));
    expect(provider.calls[0]?.user).toContain('ana@example.com');
  });

  it('classifies a provider 5xx as transient and a 429 as rate limited', async () => {
    const { activities, env } = setup([{ error: { status: 503 } }]);
    await expect(
      env().run(activities.llmClassify, input(classifyConfig('hola'))),
    ).rejects.toMatchObject({ type: 'LLM_PROVIDER_UNAVAILABLE', nonRetryable: false });

    const limited = setup([{ error: { status: 429 } }]);
    await expect(
      limited.env().run(limited.activities.llmClassify, input(classifyConfig('hola'))),
    ).rejects.toMatchObject({ type: 'LLM_PROVIDER_RATE_LIMITED', nonRetryable: false });
  });
});
