import { describe, expect, it } from 'vitest';
import {
  ERROR_CLASSES,
  ERROR_CLASS_CODES,
  backoffDelayMs,
  classify,
  isErrorClass,
  isRetryable,
} from '../../src/index.js';

describe('error taxonomy (research R1)', () => {
  it('declares the four classes of F4', () => {
    expect([...ERROR_CLASSES]).toEqual(['transient', 'rate_limited', 'timeout', 'permanent']);
  });

  it('gives each class a stable default code', () => {
    expect(ERROR_CLASS_CODES).toEqual({
      transient: 'NODE_TRANSIENT',
      rate_limited: 'NODE_RATE_LIMITED',
      timeout: 'NODE_TIMEOUT',
      permanent: 'NODE_PERMANENT',
    });
  });

  it('recognizes class names and nothing else', () => {
    expect(isErrorClass('rate_limited')).toBe(true);
    expect(isErrorClass('invalid_output')).toBe(false);
    expect(isErrorClass(undefined)).toBe(false);
    expect(isErrorClass(42)).toBe(false);
  });

  it('retries every class except permanent', () => {
    expect(ERROR_CLASSES.filter(isRetryable)).toEqual(['transient', 'rate_limited', 'timeout']);
  });
});

describe('classify', () => {
  it('trusts a class declared by the node', () => {
    for (const errorClass of ERROR_CLASSES) {
      expect(classify({ errorClass })).toBe(errorClass);
    }
  });

  it('classifies a transient failure', () => {
    expect(classify({ errorClass: 'transient', nonRetryable: false })).toBe('transient');
  });

  it('classifies a limited failure', () => {
    expect(classify({ errorClass: 'rate_limited' })).toBe('rate_limited');
  });

  it('classifies a time out reported by the engine as timeout', () => {
    expect(classify({ timedOut: true })).toBe('timeout');
  });

  it('classifies a failure that cannot be retried as permanent', () => {
    expect(classify({ nonRetryable: true })).toBe('permanent');
  });

  it('treats an unknown failure as transient (FR-002)', () => {
    expect(classify({})).toBe('transient');
    expect(classify({ errorClass: 'something_else' })).toBe('transient');
    expect(classify({ errorClass: 7 })).toBe('transient');
  });

  it('lets a declared class win over the flags of the engine', () => {
    expect(classify({ errorClass: 'transient', timedOut: true })).toBe('transient');
    expect(classify({ errorClass: 'permanent', nonRetryable: false })).toBe('permanent');
  });
});

describe('backoffDelayMs', () => {
  const noJitter = () => 0.5; // jitter factor 1

  it('doubles the wait on each failure, from the initial interval', () => {
    expect(backoffDelayMs(1, 1000, noJitter)).toBe(1000);
    expect(backoffDelayMs(2, 1000, noJitter)).toBe(2000);
    expect(backoffDelayMs(3, 1000, noJitter)).toBe(4000);
  });

  it('never exceeds the ceiling', () => {
    expect(backoffDelayMs(20, 1000, noJitter)).toBe(30_000);
  });

  it('varies the wait by at most 20 % either way', () => {
    expect(backoffDelayMs(1, 1000, () => 0)).toBe(800);
    expect(backoffDelayMs(1, 1000, () => 1)).toBe(1200);
  });

  it('is an integer number of milliseconds', () => {
    expect(Number.isInteger(backoffDelayMs(2, 333, () => 0.123))).toBe(true);
  });
});
