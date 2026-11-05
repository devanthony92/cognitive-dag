import { Writable } from 'node:stream';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseClient, type WithContext } from '@cognitive-dag/db';
import { LlmError } from '@cognitive-dag/llm';
import { createLogger } from '@cognitive-dag/logger';
import { parseEnv } from '../../src/config/env.schema';
import { loadLocalEnv } from '../../src/config/load-env';
import { createBudget, type BudgetLimits, type CallRecord } from '../../src/llm/budget';
import { NodeFailure } from '../../src/resilience/attempts';
import { seedRun, type SeededRun } from './support/seed';

loadLocalEnv();
const config = parseEnv(process.env);

interface Counters {
  runTokens: number;
  dayTokens: number;
  dayCost: number;
  calls: {
    outcome: string;
    reserved_tokens: number;
    input_tokens: number;
    error_code: string | null;
  }[];
}

describe('LLM token budget (requires docker compose up)', () => {
  let database: DatabaseClient;
  let pool: pg.Pool;
  const logLines: string[] = [];

  beforeAll(() => {
    database = createDatabase({ connectionString: config.DATABASE_URL, max: 8 });
    pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 });
  });

  afterAll(async () => {
    await pool.end();
    await database.end();
  });

  const seed = () => seedRun(pool, { schemaVersion: 1, nodes: [], edges: [] });

  const budgetWith = (limits: BudgetLimits, withContext: WithContext = database.withContext) => {
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        logLines.push(chunk.toString());
        done();
      },
    });
    return createBudget({
      withContext,
      limits,
      logger: createLogger({ component: 'worker-test', level: 'warn' }, sink),
    });
  };

  async function countersOf(run: SeededRun): Promise<Counters> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.organization_id', $1, true)", [
        run.organizationId,
      ]);
      const runRow = await client.query<{ llm_tokens_used: number }>(
        'SELECT llm_tokens_used FROM workflow_runs WHERE id = $1',
        [run.runId],
      );
      const day = await client.query<{ tokens_used: string; cost_micro_usd: string }>(
        'SELECT tokens_used, cost_micro_usd FROM llm_usage_daily WHERE organization_id = $1',
        [run.organizationId],
      );
      const calls = await client.query<Counters['calls'][number]>(
        'SELECT outcome, reserved_tokens, input_tokens, error_code FROM llm_calls WHERE run_id = $1',
        [run.runId],
      );
      await client.query('COMMIT');
      return {
        runTokens: runRow.rows[0]?.llm_tokens_used ?? 0,
        dayTokens: Number(day.rows[0]?.tokens_used ?? 0),
        dayCost: Number(day.rows[0]?.cost_micro_usd ?? 0),
        calls: calls.rows,
      };
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  const BIG = 1_000_000;

  it('reserves against the run and the organization day in one step', async () => {
    const run = await seed();
    const budget = budgetWith({ perRun: BIG, perOrganizationDay: BIG });
    const reservation = await budget.reserve({ ...run, tokens: 300 });
    expect(reservation.tokens).toBe(300);
    expect(await countersOf(run)).toMatchObject({ runTokens: 300, dayTokens: 300 });
  });

  it('refuses a reservation over the run limit without touching the day', async () => {
    const run = await seed();
    const budget = budgetWith({ perRun: 100, perOrganizationDay: BIG });
    await budget.reserve({ ...run, tokens: 80 });
    await expect(budget.reserve({ ...run, tokens: 30 })).rejects.toMatchObject({
      code: 'LLM_RUN_BUDGET_EXHAUSTED',
      errorClass: 'budget_exhausted',
    });
    expect(await countersOf(run)).toMatchObject({ runTokens: 80, dayTokens: 80 });
  });

  it('refuses over the day limit and rolls the run counter back', async () => {
    const run = await seed();
    const budget = budgetWith({ perRun: BIG, perOrganizationDay: 100 });
    await budget.reserve({ ...run, tokens: 80 });
    await expect(budget.reserve({ ...run, tokens: 30 })).rejects.toMatchObject({
      code: 'LLM_DAILY_BUDGET_EXHAUSTED',
      errorClass: 'budget_exhausted',
    });
    expect(await countersOf(run)).toMatchObject({ runTokens: 80, dayTokens: 80 });
  });

  it('refuses a first reservation larger than the whole day limit', async () => {
    const run = await seed();
    const budget = budgetWith({ perRun: BIG, perOrganizationDay: 100 });
    await expect(budget.reserve({ ...run, tokens: 101 })).rejects.toMatchObject({
      code: 'LLM_DAILY_BUDGET_EXHAUSTED',
    });
    expect(await countersOf(run)).toMatchObject({ runTokens: 0, dayTokens: 0 });
  });

  it('never goes over the run limit with 20 parallel reservations', async () => {
    const run = await seed();
    const budget = budgetWith({ perRun: 100, perOrganizationDay: BIG });
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => budget.reserve({ ...run, tokens: 10 })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
    for (const result of results) {
      if (result.status === 'rejected') {
        expect((result.reason as LlmError).code).toBe('LLM_RUN_BUDGET_EXHAUSTED');
      }
    }
    expect(await countersOf(run)).toMatchObject({ runTokens: 100, dayTokens: 100 });
  });

  it('never goes over the day limit with 20 parallel reservations', async () => {
    const first = await seed();
    const budget = budgetWith({ perRun: BIG, perOrganizationDay: 100 });
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => budget.reserve({ ...first, tokens: 10 })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
    expect((await countersOf(first)).dayTokens).toBe(100);
  });

  it('adjusts to the real tokens, records the cost and inserts the call without content', async () => {
    const run = await seed();
    const budget = budgetWith({ perRun: BIG, perOrganizationDay: BIG });
    const reservation = await budget.reserve({ ...run, tokens: 500 });
    const call: CallRecord = {
      organizationId: run.organizationId,
      runId: run.runId,
      nodeId: 'ai',
      nodeType: 'llm.classify',
      attempt: 1,
      repairs: 0,
      model: 'test-lite',
      reservedTokens: 500,
      inputTokens: 120,
      outputTokens: 30,
      costMicroUsd: 42,
      outcome: 'succeeded',
      durationMs: 15,
    };
    await budget.settle(call, [reservation]);
    const counters = await countersOf(run);
    expect(counters).toMatchObject({ runTokens: 150, dayTokens: 150, dayCost: 42 });
    expect(counters.calls).toEqual([
      { outcome: 'succeeded', reserved_tokens: 500, input_tokens: 120, error_code: null },
    ]);
  });

  it('releases the whole reservation when the call produced no tokens', async () => {
    const run = await seed();
    const budget = budgetWith({ perRun: BIG, perOrganizationDay: BIG });
    const reservation = await budget.reserve({ ...run, tokens: 200 });
    await budget.settle(
      {
        organizationId: run.organizationId,
        runId: run.runId,
        nodeId: 'ai',
        nodeType: 'llm.extract',
        attempt: 1,
        repairs: 0,
        model: 'test-lite',
        reservedTokens: 200,
        inputTokens: 0,
        outputTokens: 0,
        costMicroUsd: 0,
        outcome: 'failed',
        errorCode: 'LLM_PROVIDER_UNAVAILABLE',
        durationMs: 3,
      },
      [reservation],
    );
    const counters = await countersOf(run);
    expect(counters).toMatchObject({ runTokens: 0, dayTokens: 0 });
    expect(counters.calls[0]).toMatchObject({
      outcome: 'failed',
      error_code: 'LLM_PROVIDER_UNAVAILABLE',
    });
  });

  it('does not affect another organization when one runs out of budget', async () => {
    const a = await seed();
    const b = await seed();
    const budget = budgetWith({ perRun: BIG, perOrganizationDay: 100 });
    await budget.reserve({ ...a, tokens: 100 });
    await expect(budget.reserve({ ...a, tokens: 1 })).rejects.toMatchObject({
      code: 'LLM_DAILY_BUDGET_EXHAUSTED',
    });
    await expect(budget.reserve({ ...b, tokens: 100 })).resolves.toMatchObject({ tokens: 100 });
    expect(await countersOf(b)).toMatchObject({ runTokens: 100, dayTokens: 100 });
  });

  it('fails transient without a reservation when PostgreSQL is not available', async () => {
    const run = await seed();
    const down = (() => Promise.reject(new Error('connection refused'))) as unknown as WithContext;
    const budget = budgetWith({ perRun: BIG, perOrganizationDay: BIG }, down);
    const error = await budget.reserve({ ...run, tokens: 10 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NodeFailure);
    expect(error).toMatchObject({ errorClass: 'transient', code: 'BUDGET_STORE_UNAVAILABLE' });
    expect(await countersOf(run)).toMatchObject({ runTokens: 0, dayTokens: 0 });
  });

  it('emits the llm.budget_exhausted security event with who, which run and which budget', async () => {
    const run = await seed();
    logLines.length = 0;
    const budget = budgetWith({ perRun: 10, perOrganizationDay: BIG });
    await expect(budget.reserve({ ...run, tokens: 11 })).rejects.toBeInstanceOf(LlmError);
    const event = logLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line.event === 'llm.budget_exhausted');
    expect(event).toMatchObject({
      securityEvent: true,
      outcome: 'blocked',
      organizationId: run.organizationId,
      runId: run.runId,
      budget: 'run',
    });
  });
});
