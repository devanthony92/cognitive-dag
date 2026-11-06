import { TestWorkflowEnvironment } from '@temporalio/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompileIntentResultSchema } from '@cognitive-dag/contracts';
import {
  FakeProvider,
  type FakeStep,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from '@cognitive-dag/llm';
import {
  CompilerHarness,
  answer,
  cyclicDag,
  readState,
  seedCompilation,
  validDag,
} from './support';

const withStatus = (status: number, text = 'provider error'): FakeStep => ({
  error: Object.assign(new Error(text), { status }),
});

describe('compileIntent workflow (requires docker compose up)', () => {
  let harness: CompilerHarness;

  beforeAll(async () => {
    harness = new CompilerHarness(await TestWorkflowEnvironment.createLocal());
    harness.start();
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
    await harness?.env.teardown();
  });

  it('runs queued -> running -> succeeded and records the metrics', async () => {
    const seed = await seedCompilation(harness.pool);
    let statusDuringCall: string | undefined;
    const inner = new FakeProvider([answer(validDag())]);
    const provider: LlmProvider = {
      generate: async (request: LlmRequest): Promise<LlmResponse> => {
        statusDuringCall = (await readState(harness.pool, seed)).compilation?.status;
        return inner.generate(request);
      },
    };
    expect((await readState(harness.pool, seed)).compilation?.status).toBe('queued');

    const { result } = await harness.compile(seed, { provider });

    expect(statusDuringCall).toBe('running');
    const state = await readState(harness.pool, seed);
    expect(state.compilation).toMatchObject({
      status: 'succeeded',
      calls: 1,
      repairs: 0,
      node_count: 5,
      has_fallback: false,
      error_class: null,
      error_code: null,
    });
    expect(state.compilation?.started_at).toBeInstanceOf(Date);
    expect(state.compilation?.finished_at).toBeInstanceOf(Date);
    expect(state.compilation?.llm_tokens_used).toBeGreaterThan(0);
    expect(Number(state.compilation?.cost_micro_usd)).toBeGreaterThan(0);

    // The content is the return value of the workflow, validated by the contract.
    const parsed = CompileIntentResultSchema.parse(result);
    expect(parsed).toMatchObject({ status: 'succeeded', errorCode: null, errorClass: null });
    expect(parsed.result).toMatchObject({
      kind: 'result',
      title: 'Clasificar correos',
      validation: { valid: true, errors: [] },
    });
    expect((parsed.result?.definition['nodes'] as unknown[]).length).toBe(5);
  }, 60_000);

  it('repairs once and counts the calls and the repairs', async () => {
    const seed = await seedCompilation(harness.pool);
    const { result } = await harness.compile(seed, {
      provider: [answer(cyclicDag()), answer(validDag())],
    });
    expect(result?.status).toBe('succeeded');
    expect((await readState(harness.pool, seed)).compilation).toMatchObject({
      status: 'succeeded',
      calls: 2,
      repairs: 1,
    });
  }, 60_000);

  it('fails with COMPILER_INVALID_DAG and returns the last attempt as fallback', async () => {
    const seed = await seedCompilation(harness.pool);
    const { result } = await harness.compile(seed, {
      provider: [answer(cyclicDag()), answer(cyclicDag()), answer(cyclicDag())],
    });
    expect(result).toMatchObject({
      status: 'failed',
      errorCode: 'COMPILER_INVALID_DAG',
      errorClass: 'invalid_output',
      result: { kind: 'fallback', validation: { valid: false } },
    });
    expect((await readState(harness.pool, seed)).compilation).toMatchObject({
      status: 'failed',
      calls: 3,
      repairs: 2,
      has_fallback: true,
      node_count: 5,
      error_class: 'invalid_output',
      error_code: 'COMPILER_INVALID_DAG',
    });
  }, 60_000);

  it('fails without fallback when the answer never meets the schema', async () => {
    const seed = await seedCompilation(harness.pool);
    const bad = { text: JSON.stringify({ nope: true }) };
    const { result } = await harness.compile(seed, { provider: [bad, bad, bad] });
    expect(result).toMatchObject({ status: 'failed', result: null });
    expect((await readState(harness.pool, seed)).compilation).toMatchObject({
      status: 'failed',
      has_fallback: false,
      node_count: null,
    });
  }, 60_000);

  it('does not repair a blocked answer', async () => {
    const seed = await seedCompilation(harness.pool);
    const { result, provider } = await harness.compile(seed, {
      provider: [{ text: '{}', blocked: true }],
    });
    expect(result).toMatchObject({
      status: 'failed',
      errorCode: 'LLM_CONTENT_BLOCKED',
      errorClass: 'invalid_output',
      result: null,
    });
    expect((provider as FakeProvider).calls).toHaveLength(1);
  }, 60_000);

  it('retries a transient provider error and then succeeds', async () => {
    const seed = await seedCompilation(harness.pool);
    const { result, provider } = await harness.compile(seed, {
      provider: [withStatus(503), answer(validDag())],
    });
    expect(result?.status).toBe('succeeded');
    expect((provider as FakeProvider).calls).toHaveLength(2);
    const state = await readState(harness.pool, seed);
    expect(state.compilation?.status).toBe('succeeded');
    // One llm_calls row per call, the first one failed and the second one from attempt 2.
    expect(state.calls.map((call) => [call.attempt, call.outcome])).toEqual([
      [1, 'failed'],
      [2, 'succeeded'],
    ]);
  }, 60_000);

  it('retries a rate-limited call (429) and then succeeds', async () => {
    const seed = await seedCompilation(harness.pool);
    const { result } = await harness.compile(seed, {
      provider: [withStatus(429), answer(validDag())],
    });
    expect(result?.status).toBe('succeeded');
  }, 60_000);

  it('does not retry a permanent error', async () => {
    const seed = await seedCompilation(harness.pool);
    const { result, provider } = await harness.compile(seed, { provider: [withStatus(400)] });
    expect(result).toMatchObject({
      status: 'failed',
      errorCode: 'LLM_PROVIDER_REJECTED',
      errorClass: 'permanent',
      result: null,
    });
    expect((provider as FakeProvider).calls).toHaveLength(1);
    expect((await readState(harness.pool, seed)).compilation).toMatchObject({
      status: 'failed',
      error_class: 'permanent',
    });
  }, 60_000);

  it('gives up on a provider that stays down and marks the compilation failed', async () => {
    const seed = await seedCompilation(harness.pool);
    const { result, provider } = await harness.compile(seed, {
      provider: Array.from({ length: 10 }, () => withStatus(503)),
    });
    expect(result).toMatchObject({
      status: 'failed',
      errorCode: 'LLM_PROVIDER_UNAVAILABLE',
      errorClass: 'transient',
      result: null,
    });
    // Bounded attempts, not an endless loop.
    const calls = (provider as FakeProvider).calls.length;
    expect(calls).toBeGreaterThan(1);
    expect(calls).toBeLessThanOrEqual(5);
    expect((await readState(harness.pool, seed)).compilation).toMatchObject({
      status: 'failed',
      error_class: 'transient',
      error_code: 'LLM_PROVIDER_UNAVAILABLE',
    });
  }, 90_000);

  it('answers LLM_DISABLED without calling the model when the kill switch is off', async () => {
    const seed = await seedCompilation(harness.pool);
    const { result, provider } = await harness.compile(seed, {
      provider: [answer(validDag())],
      enabled: false,
    });
    expect(result).toMatchObject({
      status: 'failed',
      errorCode: 'LLM_DISABLED',
      errorClass: 'permanent',
      result: null,
    });
    expect((provider as FakeProvider).calls).toHaveLength(0);
    const state = await readState(harness.pool, seed);
    expect(state.compilation).toMatchObject({
      status: 'failed',
      calls: 0,
      error_code: 'LLM_DISABLED',
    });
    expect(state.calls).toHaveLength(0);
  }, 60_000);

  it('keeps the regenerate mode link to its workflow', async () => {
    const seed = await seedCompilation(harness.pool, { mode: 'regenerate' });
    const { result } = await harness.compile(seed, { provider: [answer(validDag())] });
    expect(result?.status).toBe('succeeded');
    expect((await readState(harness.pool, seed)).compilation?.status).toBe('succeeded');
  }, 60_000);

  it('rejects an invalid input before touching anything', async () => {
    const seed = await seedCompilation(harness.pool);
    const { result, error } = await harness.compile(
      seed,
      { provider: [answer(validDag())] },
      { allowedTypes: [] },
    );
    expect(result).toBeUndefined();
    expect(error).toBeDefined();
    expect((await readState(harness.pool, seed)).compilation?.status).toBe('queued');
  }, 60_000);
});
