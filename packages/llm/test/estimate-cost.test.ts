import { describe, expect, it } from 'vitest';
import {
  costMicroUsd,
  estimateReservation,
  maxOutputTokensFor,
  modelsWithoutPrice,
  parsePrices,
} from '../src/index.js';

describe('estimateReservation (research R4)', () => {
  it('is ceil(chars / 4) plus the output tokens', () => {
    expect(estimateReservation(400, 100)).toBe(200);
    expect(estimateReservation(401, 100)).toBe(201);
    expect(estimateReservation(0, 64)).toBe(64);
  });
});

describe('maxOutputTokensFor', () => {
  it('uses a small fixed cap for a classification', () => {
    expect(maxOutputTokensFor({ kind: 'classify' })).toBe(128);
  });

  it('grows with the fields of an extraction, within bounds', () => {
    const one = maxOutputTokensFor({ kind: 'extract', fieldCount: 1 });
    const ten = maxOutputTokensFor({ kind: 'extract', fieldCount: 10 });
    expect(ten).toBeGreaterThan(one);
    expect(maxOutputTokensFor({ kind: 'extract', fieldCount: 30 })).toBeLessThanOrEqual(4096);
  });

  it('derives the cap of a generation from its maxLength', () => {
    const short = maxOutputTokensFor({ kind: 'generate', maxLength: 100 });
    const long = maxOutputTokensFor({ kind: 'generate', maxLength: 10_000 });
    expect(long).toBeGreaterThan(short);
    // Spanish needs about 3 characters per token: never less than maxLength / 4.
    expect(long).toBeGreaterThanOrEqual(10_000 / 4);
    expect(short).toBeGreaterThan(100 / 4);
  });
});

describe('parsePrices', () => {
  it('reads <model>:<input>:<output> entries in micro-USD per million tokens', () => {
    const result = parsePrices('model-a:100000:400000;model-b:2500000:10000000');
    expect(result.invalid).toBe(false);
    expect(result.prices.get('model-a')).toEqual({ input: 100_000, output: 400_000 });
    expect(result.prices.get('model-b')).toEqual({ input: 2_500_000, output: 10_000_000 });
  });

  it('accepts an empty value: no prices', () => {
    expect(parsePrices('')).toEqual({ prices: new Map(), invalid: false });
    expect(parsePrices(undefined)).toEqual({ prices: new Map(), invalid: false });
  });

  it.each(['model-a', 'model-a:1', 'model-a:x:2', 'model-a:-1:2', ':1:2', 'a:1:2;a:3:4'])(
    'flags the malformed value «%s»',
    (value) => {
      expect(parsePrices(value).invalid).toBe(true);
    },
  );
});

describe('costMicroUsd', () => {
  const { prices } = parsePrices('m:100000:400000');

  it('prices input and output tokens per million', () => {
    expect(costMicroUsd(prices, 'm', 1_000_000, 500_000)).toBe(100_000 + 200_000);
  });

  it('rounds up so a call never costs zero by rounding', () => {
    expect(costMicroUsd(prices, 'm', 1, 1)).toBe(1);
  });

  it('is zero for a model without a price', () => {
    expect(costMicroUsd(prices, 'other', 1000, 1000)).toBe(0);
  });

  it('is zero for zero tokens', () => {
    expect(costMicroUsd(prices, 'm', 0, 0)).toBe(0);
  });
});

describe('modelsWithoutPrice', () => {
  it('lists the configured models that have no price, once each', () => {
    const { prices } = parsePrices('a:1:2');
    expect(modelsWithoutPrice(['a', 'b', 'b', 'c'], prices)).toEqual(['b', 'c']);
  });
});
