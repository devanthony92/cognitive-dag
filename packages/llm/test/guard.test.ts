import type { DagType } from '@cognitive-dag/dag-schema';
import { describe, expect, it } from 'vitest';
import {
  FakeProvider,
  LlmError,
  runGuarded,
  type FakeStep,
  type GuardOptions,
} from '../src/index.js';

const outputType: DagType = {
  kind: 'object',
  fields: {
    label: { kind: 'enum', values: ['spam', 'ham'] },
    confidence: { kind: 'number', min: 0, max: 1 },
  },
};

const valid = (text = '{"label":"spam","confidence":0.9}'): FakeStep => ({ text });
const invalid: FakeStep = { text: '{"label":"nope","confidence":0.9}' };

function options(provider: FakeProvider, extra: Partial<GuardOptions> = {}): GuardOptions {
  return {
    provider,
    model: 'fake-model',
    system: 'You are a classifier.',
    user: '<data-n>\nhola\n</data-n>',
    outputType,
    maxOutputTokens: 128,
    canary: 'CANARY-123',
    ...extra,
  };
}

async function failure(promise: Promise<unknown>): Promise<LlmError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LlmError);
    return error as LlmError;
  }
  throw new Error('Expected the guard to fail');
}

describe('runGuarded: valid output', () => {
  it('returns the parsed value with no repairs and the usage of the call', async () => {
    const provider = new FakeProvider([{ ...valid(), inputTokens: 40, outputTokens: 10 }]);
    const result = await runGuarded(options(provider));
    expect(result).toEqual({
      value: { label: 'spam', confidence: 0.9 },
      repairs: 0,
      calls: 1,
      inputTokens: 40,
      outputTokens: 10,
    });
  });

  it('sends the JSON schema of the output type to the provider', async () => {
    const provider = new FakeProvider([valid()]);
    await runGuarded(options(provider));
    expect(provider.calls[0]?.responseJsonSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['label', 'confidence'],
    });
    expect(provider.calls[0]?.model).toBe('fake-model');
    expect(provider.calls[0]?.maxOutputTokens).toBe(128);
  });
});

describe('runGuarded: repair (research R7)', () => {
  it('repairs a first invalid answer and reports one repair', async () => {
    const provider = new FakeProvider([invalid, valid()]);
    const result = await runGuarded(options(provider));
    expect(result.repairs).toBe(1);
    expect(result.calls).toBe(2);
  });

  it('allows up to two repairs', async () => {
    const provider = new FakeProvider([invalid, { text: 'not json' }, valid()]);
    const result = await runGuarded(options(provider));
    expect(result.repairs).toBe(2);
    expect(result.calls).toBe(3);
  });

  it('fails with LLM_INVALID_OUTPUT when the third answer is invalid too', async () => {
    const provider = new FakeProvider([invalid, invalid, invalid, valid()]);
    const error = await failure(runGuarded(options(provider)));
    expect(error.code).toBe('LLM_INVALID_OUTPUT');
    expect(error.errorClass).toBe('invalid_output');
    expect(provider.calls).toHaveLength(3);
    expect(error.repairs).toBe(2);
  });

  it('adds the previous answer and a summary of the errors as the repair turn', async () => {
    const provider = new FakeProvider([invalid, valid()]);
    await runGuarded(options(provider));
    const repair = provider.calls[1]?.repair;
    expect(repair?.previousOutput).toBe(invalid.text);
    expect(repair?.errors.join('\n')).toContain('label');
    expect(provider.calls[0]?.repair).toBeUndefined();
  });

  it('keeps the user text out of the error summary', async () => {
    const secret = 'TOP-SECRET-USER-TEXT';
    const provider = new FakeProvider([
      { text: `{"label":"${secret}","confidence":2,"${secret}":1}` },
      valid(),
    ]);
    await runGuarded(options(provider, { user: `<data-n>\n${secret}\n</data-n>` }));
    const summary = provider.calls[1]?.repair?.errors.join('\n') ?? '';
    expect(summary).not.toContain(secret);
    expect(summary.length).toBeGreaterThan(0);
  });

  it('summarizes a response that is not JSON', async () => {
    const provider = new FakeProvider([{ text: 'hello there' }, valid()]);
    await runGuarded(options(provider));
    expect(provider.calls[1]?.repair?.errors.join('\n')).toMatch(/JSON/);
  });

  it('adds up the tokens of every call, repairs included', async () => {
    const provider = new FakeProvider([
      { ...invalid, inputTokens: 40, outputTokens: 10 },
      { ...valid(), inputTokens: 60, outputTokens: 12 },
    ]);
    const result = await runGuarded(options(provider));
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(22);
  });

  it('reports the tokens spent when it gives up', async () => {
    const provider = new FakeProvider([
      { ...invalid, inputTokens: 10, outputTokens: 5 },
      { ...invalid, inputTokens: 10, outputTokens: 5 },
      { ...invalid, inputTokens: 10, outputTokens: 5 },
    ]);
    const error = await failure(runGuarded(options(provider)));
    expect(error.usage).toEqual({ inputTokens: 30, outputTokens: 15 });
  });

  it('calls beforeCall before every call so each repair reserves budget again', async () => {
    const seen: number[] = [];
    const provider = new FakeProvider([invalid, valid()]);
    await runGuarded(
      options(provider, {
        beforeCall: (call) => {
          seen.push(call);
        },
      }),
    );
    expect(seen).toEqual([0, 1]);
  });

  it('stops without calling the provider when beforeCall refuses', async () => {
    const provider = new FakeProvider([valid()]);
    const refusal = new LlmError('LLM_RUN_BUDGET_EXHAUSTED', 'sin presupuesto');
    const error = await failure(
      runGuarded(
        options(provider, {
          beforeCall: () => {
            throw refusal;
          },
        }),
      ),
    );
    expect(error).toBe(refusal);
    expect(provider.calls).toHaveLength(0);
  });
});

describe('runGuarded: blocked, truncated and leaked', () => {
  it('fails with LLM_CONTENT_BLOCKED without repairing', async () => {
    const provider = new FakeProvider([
      { text: '', blocked: true, finishReason: 'safety' },
      valid(),
    ]);
    const error = await failure(runGuarded(options(provider)));
    expect(error.code).toBe('LLM_CONTENT_BLOCKED');
    expect(error.errorClass).toBe('invalid_output');
    expect(provider.calls).toHaveLength(1);
  });

  it('treats a finish reason of safety as a block even when text came back', async () => {
    const provider = new FakeProvider([{ ...valid(), finishReason: 'safety' }, valid()]);
    const error = await failure(runGuarded(options(provider)));
    expect(error.code).toBe('LLM_CONTENT_BLOCKED');
  });

  it('repairs an answer cut by the token limit', async () => {
    const provider = new FakeProvider([
      { text: '{"label":"spa', finishReason: 'max_tokens' },
      valid(),
    ]);
    const result = await runGuarded(options(provider));
    expect(result.repairs).toBe(1);
    expect(provider.calls[1]?.repair?.errors.join('\n')).toMatch(/truncated/i);
  });

  it('fails with LLM_CANARY_LEAK when the canary shows in the output, without repairing', async () => {
    const provider = new FakeProvider([
      { text: '{"label":"spam","confidence":0.5,"note":"CANARY-123"}' },
      valid(),
    ]);
    const error = await failure(runGuarded(options(provider)));
    expect(error.code).toBe('LLM_CANARY_LEAK');
    expect(error.errorClass).toBe('invalid_output');
    expect(provider.calls).toHaveLength(1);
  });

  it('detects the canary even in an otherwise valid generation', async () => {
    const provider = new FakeProvider([{ text: '{"text":"mira CANARY-123 aquí"}' }]);
    const error = await failure(
      runGuarded(
        options(provider, {
          outputType: { kind: 'object', fields: { text: { kind: 'string' } } },
        }),
      ),
    );
    expect(error.code).toBe('LLM_CANARY_LEAK');
  });
});

describe('runGuarded: generation does not clip', () => {
  const generation: Partial<GuardOptions> = {
    outputType: { kind: 'object', fields: { text: { kind: 'string' } } },
    check: (value) => {
      const text = (value as { text: string }).text;
      return text.length > 10 ? ['text: longer than the maximum length'] : [];
    },
  };

  it('accepts a text within maxLength', async () => {
    const provider = new FakeProvider([{ text: '{"text":"hola"}' }]);
    const result = await runGuarded(options(provider, generation));
    expect(result.value).toEqual({ text: 'hola' });
  });

  it('treats a text over maxLength as invalid output (repairable), never trims it', async () => {
    const long = '{"text":"abcdefghijklmnop"}';
    const provider = new FakeProvider([{ text: long }, { text: '{"text":"corto"}' }]);
    const result = await runGuarded(options(provider, generation));
    expect(result.value).toEqual({ text: 'corto' });
    expect(result.repairs).toBe(1);
    expect(provider.calls[1]?.repair?.errors.join('\n')).toContain('maximum length');
  });

  it('fails after the repairs when the text stays too long', async () => {
    const long: FakeStep = { text: '{"text":"abcdefghijklmnop"}' };
    const provider = new FakeProvider([long, long, long]);
    const error = await failure(runGuarded(options(provider, generation)));
    expect(error.code).toBe('LLM_INVALID_OUTPUT');
  });
});

describe('runGuarded: provider errors', () => {
  it('translates a provider failure to the taxonomy', async () => {
    const provider = new FakeProvider([{ error: Object.assign(new Error('x'), { status: 503 }) }]);
    const error = await failure(runGuarded(options(provider)));
    expect(error.code).toBe('LLM_PROVIDER_UNAVAILABLE');
  });

  it('carries the tokens spent by earlier calls when a later call fails', async () => {
    const provider = new FakeProvider([
      { ...invalid, inputTokens: 10, outputTokens: 5 },
      { error: Object.assign(new Error('x'), { status: 429 }) },
    ]);
    const error = await failure(runGuarded(options(provider)));
    expect(error.code).toBe('LLM_PROVIDER_RATE_LIMITED');
    expect(error.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });
});
