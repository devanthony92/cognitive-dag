import { describe, expect, it } from 'vitest';
import {
  FakeProvider,
  LlmError,
  buildPrompt,
  newGuardTokens,
  runGuarded,
  toZodSchema,
  type PromptSpec,
} from '../../src/index.js';
import { fieldsToObject, type DagType, type FieldSpec } from '@cognitive-dag/dag-schema';
import cases from './cases.json' with { type: 'json' };

// Prompt injection set (US4, research R8). Each case pairs a hostile user text with the malicious
// answer a compromised model could give. The guard must reject it, or the answer must be valid
// by schema: nothing else gets out. `pnpm eval:llm` runs the same set against the real model.

interface InjectionCase {
  id: string;
  kind: 'classify' | 'extract' | 'generate';
  labels?: string[];
  fields?: FieldSpec[];
  maxLength?: number;
  userText: string;
  output: string;
  expect: 'rejected' | 'valid';
  note: string;
}

const MAX_LENGTH = 200;

function setup(testCase: InjectionCase): { spec: PromptSpec; outputType: DagType } {
  switch (testCase.kind) {
    case 'classify':
      return {
        spec: { kind: 'classify', labels: testCase.labels ?? [] },
        outputType: {
          kind: 'object',
          fields: {
            label: { kind: 'enum', values: testCase.labels ?? [] },
            confidence: { kind: 'number', min: 0, max: 1 },
          },
        },
      };
    case 'extract':
      return {
        spec: { kind: 'extract', fields: testCase.fields ?? [] },
        outputType: fieldsToObject(testCase.fields ?? []),
      };
    case 'generate':
      return {
        spec: { kind: 'generate', language: 'es', maxLength: testCase.maxLength ?? MAX_LENGTH },
        outputType: { kind: 'object', fields: { text: { kind: 'string' } } },
      };
  }
}

describe('injection set', () => {
  it('has about thirty cases covering the three node types', () => {
    expect(cases.length).toBeGreaterThanOrEqual(30);
    const kinds = new Set((cases as InjectionCase[]).map((c) => c.kind));
    expect([...kinds].sort()).toEqual(['classify', 'extract', 'generate']);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  it.each(cases as InjectionCase[])('$id: $note', async (testCase) => {
    const { spec, outputType } = setup(testCase);
    const tokens = newGuardTokens();
    const prompt = buildPrompt(spec, testCase.userText, tokens);
    const output = testCase.output.replaceAll('{{CANARY}}', tokens.canary);
    // The model answers the same hostile thing every time, repairs included.
    const provider = new FakeProvider([{ text: output }, { text: output }, { text: output }]);
    const maxLength = testCase.maxLength ?? MAX_LENGTH;

    let escaped = false;
    let outcome: 'rejected' | 'valid';
    try {
      const result = await runGuarded({
        provider,
        model: 'fake-model',
        ...prompt,
        outputType,
        maxOutputTokens: 256,
        canary: tokens.canary,
        check:
          testCase.kind === 'generate'
            ? (value) =>
                (value as { text: string }).text.length > maxLength ? ['text: too long'] : []
            : undefined,
      });
      outcome = 'valid';
      // What gets out is valid by schema and never carries the canary.
      expect(toZodSchema(outputType).safeParse(result.value).success).toBe(true);
      escaped = JSON.stringify(result.value).includes(tokens.canary);
    } catch (error) {
      expect(error).toBeInstanceOf(LlmError);
      expect((error as LlmError).errorClass).toBe('invalid_output');
      outcome = 'rejected';
    }

    expect(escaped).toBe(false);
    expect(outcome).toBe(testCase.expect);
    // The hostile text only ever travels inside the data block.
    expect(prompt.user.startsWith(`<data-${tokens.nonce}>\n`)).toBe(true);
    expect(prompt.system).not.toContain(testCase.userText);
  });
});
