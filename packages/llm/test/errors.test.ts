import { describe, expect, it } from 'vitest';
import { LlmError, translateProviderError } from '../src/index.js';

describe('translateProviderError', () => {
  it.each([500, 502, 503, 504])(
    'maps HTTP %i to LLM_PROVIDER_UNAVAILABLE (transient)',
    (status) => {
      const error = translateProviderError(Object.assign(new Error('boom'), { status }));
      expect(error).toBeInstanceOf(LlmError);
      expect(error.code).toBe('LLM_PROVIDER_UNAVAILABLE');
      expect(error.errorClass).toBe('transient');
    },
  );

  it('maps a network failure to LLM_PROVIDER_UNAVAILABLE', () => {
    const error = translateProviderError(new TypeError('fetch failed'));
    expect(error.code).toBe('LLM_PROVIDER_UNAVAILABLE');
    expect(error.errorClass).toBe('transient');
  });

  it('maps 429 to LLM_PROVIDER_RATE_LIMITED (rate_limited)', () => {
    const error = translateProviderError(Object.assign(new Error('quota'), { status: 429 }));
    expect(error.code).toBe('LLM_PROVIDER_RATE_LIMITED');
    expect(error.errorClass).toBe('rate_limited');
  });

  it.each([400, 401, 403])('maps HTTP %i to LLM_PROVIDER_REJECTED (permanent)', (status) => {
    const error = translateProviderError(Object.assign(new Error('no'), { status }));
    expect(error.code).toBe('LLM_PROVIDER_REJECTED');
    expect(error.errorClass).toBe('permanent');
  });

  it('keeps an error that is already translated', () => {
    const original = new LlmError('LLM_CONTENT_BLOCKED', 'bloqueado');
    expect(translateProviderError(original)).toBe(original);
  });

  it('never copies the provider message, which may hold content or keys', () => {
    const error = translateProviderError(
      Object.assign(new Error('key=AIzaSECRET text=hola'), { status: 400 }),
    );
    expect(error.message).not.toContain('AIzaSECRET');
    expect(error.message).not.toContain('hola');
    expect(JSON.stringify(error)).not.toContain('AIzaSECRET');
  });

  it('treats what nothing explains as unavailable: trying again is safe', () => {
    expect(translateProviderError('weird').code).toBe('LLM_PROVIDER_UNAVAILABLE');
  });
});

describe('LlmError', () => {
  it.each([
    ['LLM_INVALID_OUTPUT', 'invalid_output'],
    ['LLM_CONTENT_BLOCKED', 'invalid_output'],
    ['LLM_CANARY_LEAK', 'invalid_output'],
    ['LLM_RUN_BUDGET_EXHAUSTED', 'budget_exhausted'],
    ['LLM_DAILY_BUDGET_EXHAUSTED', 'budget_exhausted'],
    ['LLM_INPUT_TOO_LARGE', 'permanent'],
    ['LLM_EMPTY_INPUT', 'permanent'],
    ['LLM_DISABLED', 'permanent'],
    ['LLM_PROVIDER_REJECTED', 'permanent'],
    ['LLM_PROVIDER_UNAVAILABLE', 'transient'],
    ['LLM_PROVIDER_RATE_LIMITED', 'rate_limited'],
  ] as const)('%s belongs to the class %s (research R15)', (code, errorClass) => {
    expect(new LlmError(code, 'x').errorClass).toBe(errorClass);
  });
});
