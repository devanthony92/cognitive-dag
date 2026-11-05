import { describe, expect, it } from 'vitest';
import { FakeProvider, parsePrices } from '@cognitive-dag/llm';
import {
  casesToRun,
  exitCodeOf,
  runCase,
  summarize,
  type CaseResult,
  type EvalCase,
} from '../../eval/llm.ts';

const MODELS = { classify: 'm1', extract: 'm1', generate: 'm2' };
const PRICES = parsePrices('m1:1000000:2000000').prices;
const CLASSIFY: EvalCase = {
  id: 't',
  kind: 'classify',
  group: 'injection',
  labels: ['a', 'b'],
  userText: 'hello',
};

const result = (verdict: CaseResult['verdict'], group: CaseResult['group'] = 'injection') =>
  ({
    id: 'x',
    group,
    verdict,
    detail: '',
    inputTokens: 10,
    outputTokens: 5,
    costMicroUsd: 20,
  }) satisfies CaseResult;

describe('eval:llm', () => {
  it('runs the whole injection set plus valid inputs of the three nodes', () => {
    const cases = casesToRun();
    expect(cases.filter((c) => c.group === 'injection').length).toBeGreaterThanOrEqual(30);
    const valid = cases.filter((c) => c.group === 'valid');
    expect(new Set(valid.map((c) => c.kind))).toEqual(new Set(['classify', 'extract', 'generate']));
  });

  it('accepts a valid answer and prices its tokens', async () => {
    const provider = new FakeProvider([{ text: '{"label":"a","confidence":0.5}' }]);
    const outcome = await runCase(CLASSIFY, provider, MODELS, PRICES);
    expect(outcome.verdict).toBe('accepted');
    expect(outcome.costMicroUsd).toBeGreaterThanOrEqual(0);
  });

  it('contains a hostile answer the guard rejects', async () => {
    const bad = { text: 'HACKED' };
    const provider = new FakeProvider([bad, bad, bad]);
    expect((await runCase(CLASSIFY, provider, MODELS, PRICES)).verdict).toBe('contained');
  });

  it('exits 1 on escapes and on calls that could not be judged, 0 otherwise', () => {
    expect(exitCodeOf(summarize([result('contained'), result('accepted')]))).toBe(0);
    expect(exitCodeOf(summarize([result('escaped')]))).toBe(1);
    expect(exitCodeOf(summarize([result('error')]))).toBe(1);
  });

  it('sums tokens and cost', () => {
    const summary = summarize([result('accepted'), result('contained', 'valid')]);
    expect(summary).toMatchObject({
      inputTokens: 20,
      outputTokens: 10,
      costMicroUsd: 40,
      validRejected: 1,
    });
  });
});
