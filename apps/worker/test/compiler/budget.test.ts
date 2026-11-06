import { TestWorkflowEnvironment } from '@temporalio/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '@cognitive-dag/logger';
import { LlmError, type FakeProvider } from '@cognitive-dag/llm';
import { createCompilerBudget, CompilerBudgetError } from '../../src/compiler/budget';
import {
  CompilerHarness,
  answer,
  cyclicDag,
  readState,
  seedCompilation,
  validDag,
} from './support';

describe('compiler budget (requires docker compose up)', () => {
  let harness: CompilerHarness;

  beforeAll(async () => {
    harness = new CompilerHarness(await TestWorkflowEnvironment.createLocal());
    harness.start();
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
    await harness?.env.teardown();
  });

  const budgetWith = (perCompilation: number, perOrganizationDay: number) =>
    createCompilerBudget({
      withContext: harness.database.withContext,
      limits: { perCompilation, perOrganizationDay },
      logger: createLogger({ component: 'budget-test', level: 'warn' }),
    });

  describe('reserve and settle', () => {
    it('reserves against the compilation and the organization day in one step', async () => {
      const seed = await seedCompilation(harness.pool);
      const budget = budgetWith(10_000, 100_000);
      const reservation = await budget.reserve({ ...seed, tokens: 4000 });
      expect(reservation.tokens).toBe(4000);
      const state = await readState(harness.pool, seed);
      expect(state.compilation?.llm_tokens_used).toBe(4000);
      expect(Number(state.day?.tokens_used)).toBe(4000);
    });

    it('refuses a reservation over the per-compilation cap without touching the day', async () => {
      const seed = await seedCompilation(harness.pool);
      const budget = budgetWith(5000, 100_000);
      await budget.reserve({ ...seed, tokens: 4000 });
      await expect(budget.reserve({ ...seed, tokens: 2000 })).rejects.toBeInstanceOf(
        CompilerBudgetError,
      );
      await expect(budget.reserve({ ...seed, tokens: 2000 })).rejects.toMatchObject({
        errorClass: 'budget_exhausted',
      });
      const state = await readState(harness.pool, seed);
      expect(state.compilation?.llm_tokens_used).toBe(4000);
      expect(Number(state.day?.tokens_used)).toBe(4000);
    });

    it('refuses over the day limit and rolls the compilation counter back', async () => {
      const seed = await seedCompilation(harness.pool);
      const budget = budgetWith(100_000, 5000);
      await budget.reserve({ ...seed, tokens: 4000 });
      const refused = await budget
        .reserve({ ...seed, tokens: 2000 })
        .catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(LlmError);
      expect(refused).not.toBeInstanceOf(CompilerBudgetError);
      expect(refused).toMatchObject({
        code: 'LLM_DAILY_BUDGET_EXHAUSTED',
        errorClass: 'budget_exhausted',
      });
      const state = await readState(harness.pool, seed);
      expect(state.compilation?.llm_tokens_used).toBe(4000);
      expect(Number(state.day?.tokens_used)).toBe(4000);
    });

    it('shares the daily row with every other owner of the organization', async () => {
      const seed = await seedCompilation(harness.pool);
      const budget = budgetWith(100_000, 100_000);
      await budget.reserve({ ...seed, tokens: 1000 });
      const second = await seedCompilation(harness.pool);
      // Another organization has its own row.
      await budget.reserve({ ...second, tokens: 500 });
      expect(Number((await readState(harness.pool, seed)).day?.tokens_used)).toBe(1000);
      expect(Number((await readState(harness.pool, second)).day?.tokens_used)).toBe(500);
    });

    it('settles by what the call really used and inserts one llm_calls row', async () => {
      const seed = await seedCompilation(harness.pool);
      const budget = budgetWith(100_000, 100_000);
      const reservation = await budget.reserve({ ...seed, tokens: 4000 });
      await budget.settle(
        {
          organizationId: seed.organizationId,
          compilationId: seed.compilationId,
          attempt: 1,
          repairs: 0,
          model: 'test-compiler',
          reservedTokens: 4000,
          inputTokens: 1200,
          outputTokens: 300,
          costMicroUsd: 77,
          outcome: 'succeeded',
          durationMs: 10,
        },
        reservation,
      );
      const state = await readState(harness.pool, seed);
      expect(state.compilation?.llm_tokens_used).toBe(1500);
      expect(Number(state.compilation?.cost_micro_usd)).toBe(77);
      expect(Number(state.day?.tokens_used)).toBe(1500);
      expect(Number(state.day?.cost_micro_usd)).toBe(77);
      expect(state.calls).toHaveLength(1);
      expect(state.calls[0]).toMatchObject({
        node_type: 'compiler',
        run_id: null,
        node_id: null,
        compilation_id: seed.compilationId,
        reserved_tokens: 4000,
        input_tokens: 1200,
        output_tokens: 300,
        outcome: 'succeeded',
      });
    });
  });

  describe('through compileIntent', () => {
    it('reserves and settles every call and writes one llm_calls row per call', async () => {
      const seed = await seedCompilation(harness.pool);
      const { result } = await harness.compile(seed, {
        provider: [
          answer(cyclicDag(), { inputTokens: 900, outputTokens: 400 }),
          answer(cyclicDag(), { inputTokens: 950, outputTokens: 420 }),
          answer(validDag(), { inputTokens: 980, outputTokens: 450 }),
        ],
      });
      expect(result?.status).toBe('succeeded');
      const state = await readState(harness.pool, seed);
      expect(state.calls).toHaveLength(3);
      expect(state.calls.map((call) => call.repairs)).toEqual([0, 1, 2]);
      expect(state.calls.map((call) => call.outcome)).toEqual([
        'invalid_output',
        'invalid_output',
        'succeeded',
      ]);
      expect(state.calls.every((call) => call.node_type === 'compiler')).toBe(true);
      expect(state.calls.every((call) => call.attempt === 1)).toBe(true);
      expect(state.calls.every((call) => call.reserved_tokens > 1300)).toBe(true);
      // After settling, the counters hold what was used, not what was reserved.
      const used = 900 + 400 + 950 + 420 + 980 + 450;
      expect(state.compilation?.llm_tokens_used).toBe(used);
      expect(Number(state.day?.tokens_used)).toBe(used);
      expect(
        state.calls.reduce((sum, call) => sum + call.input_tokens + call.output_tokens, 0),
      ).toBe(used);
    }, 60_000);

    it('stops at the per-compilation cap before the next call', async () => {
      const seed = await seedCompilation(harness.pool);
      const { result, provider } = await harness.compile(
        seed,
        {
          // The first answer used far more than the average, so a second reservation does not fit.
          provider: [answer(cyclicDag(), { inputTokens: 6000, outputTokens: 3000 })],
          perCompilation: 12_000,
        },
        {},
      );
      expect(result).toMatchObject({
        status: 'failed',
        errorCode: 'COMPILER_BUDGET_EXHAUSTED',
        errorClass: 'budget_exhausted',
      });
      expect((provider as FakeProvider).calls).toHaveLength(1);
      const state = await readState(harness.pool, seed);
      expect(state.compilation).toMatchObject({
        status: 'failed',
        calls: 1,
        error_code: 'COMPILER_BUDGET_EXHAUSTED',
        error_class: 'budget_exhausted',
      });
      expect(state.calls).toHaveLength(1);
    }, 60_000);

    it('refuses a compilation whose first reservation exceeds the cap, without calling', async () => {
      const seed = await seedCompilation(harness.pool);
      const { result, provider } = await harness.compile(seed, {
        provider: [answer(validDag())],
        perCompilation: 2000,
      });
      expect(result).toMatchObject({ status: 'failed', errorCode: 'COMPILER_BUDGET_EXHAUSTED' });
      expect((provider as FakeProvider).calls).toHaveLength(0);
      const state = await readState(harness.pool, seed);
      expect(state.calls).toHaveLength(0);
      expect(state.compilation?.llm_tokens_used).toBe(0);
    }, 60_000);

    it('answers LLM_DAILY_BUDGET_EXHAUSTED when the organization day is spent', async () => {
      const seed = await seedCompilation(harness.pool);
      const { result, provider } = await harness.compile(seed, {
        provider: [answer(validDag())],
        perOrganizationDay: 2000,
      });
      expect(result).toMatchObject({
        status: 'failed',
        errorCode: 'LLM_DAILY_BUDGET_EXHAUSTED',
        errorClass: 'budget_exhausted',
      });
      expect((provider as FakeProvider).calls).toHaveLength(0);
      expect((await readState(harness.pool, seed)).compilation).toMatchObject({
        status: 'failed',
        error_code: 'LLM_DAILY_BUDGET_EXHAUSTED',
      });
    }, 60_000);

    it('emits the security event llm.budget_exhausted without the intent', async () => {
      const seed = await seedCompilation(harness.pool);
      const before = harness.logs.length;
      await harness.compile(seed, { provider: [answer(validDag())], perOrganizationDay: 2000 });
      const lines = harness.logs.slice(before).join('');
      expect(lines).toContain('llm.budget_exhausted');
      expect(lines).toContain(seed.compilationId);
    }, 60_000);
  });
});
