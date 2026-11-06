import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeProvider, LlmError, parsePrices } from '@cognitive-dag/llm';
import {
  exitCodeOf,
  loadCases,
  recordedProvider,
  runCase,
  summarize,
  type CaseResult,
} from '../../eval/compiler.ts';

const PRICES = parsePrices('m1:1000000:2000000').prices;
const EVALS = resolve(import.meta.dirname, '../../../packages/compiler/evals');

describe('compiler eval dataset (research R11)', () => {
  const { intents, injection } = loadCases();

  it('has about 30 intents in Spanish and English and about 10 injection cases', () => {
    expect(intents.length).toBeGreaterThanOrEqual(30);
    expect(injection.length).toBeGreaterThanOrEqual(10);
    expect(intents.some((c) => c.llmNodes === false)).toBe(true);
  });

  it('has unique ids and a recorded answer for every case', () => {
    const ids = [...intents, ...injection].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids)
      expect(existsSync(resolve(EVALS, 'fake-responses', `${id}.json`))).toBe(true);
  });

  it('passes every intent and contains every injection with the recorded answers (CI)', async () => {
    const results: CaseResult[] = [];
    const options = { provider: (id: string) => recordedProvider(id), model: 'm1', prices: PRICES };
    for (const c of intents) results.push(await runCase(c, 'intent', options));
    for (const c of injection) results.push(await runCase(c, 'injection', options));
    const failing = results.filter((r) => r.verdict !== 'passed' && r.verdict !== 'contained');
    expect(failing).toEqual([]);
    const summary = summarize(results);
    expect(summary.successRate).toBe(1);
    expect(summary.escaped).toBe(0);
    expect(summary.costMicroUsd).toBeGreaterThan(0);
    expect(exitCodeOf(summary)).toBe(0);
  });
});

describe('runCase', () => {
  const intent = {
    id: 'x',
    intent: 'Do something',
    llmNodes: false,
    expected: { requiredTypes: ['mock.service'] },
  };

  it('fails an intent whose DAG misses an expected property', async () => {
    const dag = {
      title: 'T',
      nodes: [{ id: 'start', type: 'trigger.manual', label: 'S', config: {} }],
      edges: [],
    };
    const result = await runCase(intent, 'intent', {
      provider: () => new FakeProvider([{ text: JSON.stringify(dag) }]),
      model: 'm1',
      prices: PRICES,
    });
    expect(result.verdict).toBe('failed');
    expect(result.detail).toBe('missing type mock.service');
  });

  it('retries transient failures and reports an error after the retries, without the message', async () => {
    const waits: number[] = [];
    const result = await runCase(intent, 'intent', {
      provider: () =>
        new FakeProvider([{ error: Object.assign(new Error('secret detail'), { status: 503 }) }]),
      model: 'm1',
      prices: PRICES,
      backoffMs: [1, 2],
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    expect(waits).toEqual([1, 2]);
    expect(result.verdict).toBe('error');
    expect(result.retries).toBe(2);
    expect(result.detail).toBe('LLM_PROVIDER_UNAVAILABLE (transient)');
    expect(result.detail).not.toContain('secret');
  });

  it('counts a budget failure as an error, not a verdict', async () => {
    const result = await runCase(intent, 'intent', {
      provider: () => ({
        generate: () => Promise.reject(new LlmError('LLM_DAILY_BUDGET_EXHAUSTED', 'x')),
      }),
      model: 'm1',
      prices: PRICES,
    });
    expect(result.verdict).toBe('error');
  });
});

describe('exit code', () => {
  const base: CaseResult = {
    id: 'x',
    group: 'intent',
    verdict: 'passed',
    detail: '',
    repairs: 0,
    inputTokens: 1,
    outputTokens: 1,
    costMicroUsd: 0,
    retries: 0,
  };
  const many = (verdicts: CaseResult['verdict'][]) =>
    verdicts.map((verdict) => ({ ...base, verdict }));

  it('fails under 80 % of success', () => {
    expect(exitCodeOf(summarize(many(['passed', 'passed', 'passed', 'passed', 'failed'])))).toBe(0);
    expect(exitCodeOf(summarize(many(['passed', 'passed', 'passed', 'failed', 'failed'])))).toBe(1);
  });

  it('fails on any escape or call error', () => {
    expect(
      exitCodeOf(
        summarize([...many(['passed']), { ...base, group: 'injection', verdict: 'escaped' }]),
      ),
    ).toBe(1);
    expect(exitCodeOf(summarize(many(['passed', 'error'])))).toBe(1);
  });
});
