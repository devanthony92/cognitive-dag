import { describe, expect, it } from 'vitest';
import {
  FakeProvider,
  GeminiProvider,
  runGuarded,
  toJsonSchema,
  type GeminiClient,
  type LlmRequest,
} from '../src/index.js';

const request: LlmRequest = {
  model: 'm',
  system: 'sys',
  user: 'hello world!',
  responseJsonSchema: toJsonSchema({
    kind: 'object',
    fields: {
      label: { kind: 'enum', values: ['a', 'b'] },
      confidence: { kind: 'number', min: 0, max: 1 },
    },
  }),
  maxOutputTokens: 100,
};

describe('FakeProvider', () => {
  it('counts tokens as ceil(chars / 4)', async () => {
    const provider = new FakeProvider([{ text: '12345678' }]);
    const response = await provider.generate(request);
    expect(response.inputTokens).toBe(Math.ceil(('sys' + 'hello world!').length / 4));
    expect(response.outputTokens).toBe(2);
    expect(response.finishReason).toBe('stop');
    expect(response.blocked).toBe(false);
  });

  it('answers a valid sample of the schema when it has no script', async () => {
    const response = await new FakeProvider().generate(request);
    expect(JSON.parse(response.text)).toEqual({ label: 'a', confidence: 0.5 });
  });

  it('is accepted by the guard with no script (what LLM_PROVIDER=fake does)', async () => {
    const result = await runGuarded({
      provider: new FakeProvider(),
      model: 'm',
      system: 's',
      user: 'u',
      outputType: {
        kind: 'object',
        fields: { name: { kind: 'string' }, when: { kind: 'datetime' }, ok: { kind: 'boolean' } },
      },
      maxOutputTokens: 100,
      canary: 'c',
    });
    expect(result.repairs).toBe(0);
  });

  it('throws the error of a script step and fails when the script ends', async () => {
    const provider = new FakeProvider([{ error: new Error('boom') }]);
    await expect(provider.generate(request)).rejects.toThrow('boom');
    await expect(provider.generate(request)).rejects.toThrow('exhausted');
  });
});

describe('GeminiProvider', () => {
  function client(response: Awaited<ReturnType<GeminiClient['models']['generateContent']>>) {
    const seen: unknown[] = [];
    const stub: GeminiClient = {
      models: {
        generateContent: (params) => {
          seen.push(params);
          return Promise.resolve(response);
        },
      },
    };
    return { stub, seen };
  }

  it('asks for structured output and maps the usage', async () => {
    const { stub, seen } = client({
      text: '{"label":"a","confidence":1}',
      candidates: [{ finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 9 },
    });
    const response = await new GeminiProvider({ client: stub }).generate(request);
    expect(response).toEqual({
      text: '{"label":"a","confidence":1}',
      inputTokens: 30,
      outputTokens: 9,
      finishReason: 'stop',
      blocked: false,
    });
    expect(seen[0]).toMatchObject({
      model: 'm',
      config: {
        systemInstruction: 'sys',
        responseMimeType: 'application/json',
        responseJsonSchema: request.responseJsonSchema,
        maxOutputTokens: 100,
      },
    });
  });

  it('adds the rejected answer and the errors as turns of a repair', async () => {
    const { stub, seen } = client({ text: '{}', candidates: [{ finishReason: 'STOP' }] });
    await new GeminiProvider({ client: stub }).generate({
      ...request,
      repair: { previousOutput: 'bad', errors: ['label: wrong type'] },
    });
    const contents = (seen[0] as { contents: { role: string; parts: { text: string }[] }[] })
      .contents;
    expect(contents.map((turn) => turn.role)).toEqual(['user', 'model', 'user']);
    expect(contents[1]?.parts[0]?.text).toBe('bad');
    expect(contents[2]?.parts[0]?.text).toContain('label: wrong type');
  });

  it.each([
    ['MAX_TOKENS', 'max_tokens', false],
    ['SAFETY', 'safety', true],
    ['PROHIBITED_CONTENT', 'safety', true],
    ['OTHER', 'other', false],
  ])('maps the finish reason %s', async (reason, expected, blocked) => {
    const { stub } = client({ text: '', candidates: [{ finishReason: reason }] });
    const response = await new GeminiProvider({ client: stub }).generate(request);
    expect(response.finishReason).toBe(expected);
    expect(response.blocked).toBe(blocked);
  });

  it('flags a blocked prompt', async () => {
    const { stub } = client({ promptFeedback: { blockReason: 'SAFETY' } });
    const response = await new GeminiProvider({ client: stub }).generate(request);
    expect(response.blocked).toBe(true);
    expect(response.text).toBe('');
  });
});
