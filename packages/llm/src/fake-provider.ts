import type { FinishReason, LlmProvider, LlmRequest, LlmResponse } from './provider.js';
import type { JsonSchema } from './schema.js';

/** One step of a script: what the fake answers to one call, or the failure it throws. */
export type FakeStep =
  | {
      text: string;
      finishReason?: FinishReason;
      blocked?: boolean;
      inputTokens?: number;
      outputTokens?: number;
    }
  | { error: unknown };

/** Tokens as the engine estimates them: `ceil(chars / 4)`. */
const tokens = (text: string): number => Math.ceil(text.length / 4);

/** A value that satisfies a JSON Schema of `toJsonSchema`, always the same one. */
export function sampleFromJsonSchema(schema: JsonSchema): unknown {
  const enumValues = schema.enum as unknown[] | undefined;
  if (enumValues) return enumValues[0];
  switch (schema.type) {
    case 'string':
      return schema.format === 'date-time' ? '2026-01-01T00:00:00Z' : 'texto de ejemplo';
    case 'number':
      return typeof schema.minimum === 'number' && typeof schema.maximum === 'number'
        ? (schema.minimum + schema.maximum) / 2
        : 1;
    case 'boolean':
      return true;
    case 'array':
      return [sampleFromJsonSchema(schema.items as JsonSchema)];
    case 'object': {
      const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
      return Object.fromEntries(
        Object.entries(properties).map(([name, field]) => [name, sampleFromJsonSchema(field)]),
      );
    }
    default:
      return null;
  }
}

/**
 * Deterministic provider for tests and for `LLM_PROVIDER=fake` (research R2). With a script it
 * answers step by step: valid or malicious outputs, blocks, 5xx and 429. Without one it answers
 * every call with a valid sample of the requested schema. It never touches the network.
 */
export class FakeProvider implements LlmProvider {
  /** Every request received, in order. */
  readonly calls: LlmRequest[] = [];
  private position = 0;

  private readonly script: readonly FakeStep[] | undefined;

  constructor(script?: readonly FakeStep[]) {
    this.script = script;
  }

  generate(request: LlmRequest): Promise<LlmResponse> {
    this.calls.push(request);
    const step = this.script ? this.script[this.position++] : this.sample(request);
    if (!step) return Promise.reject(new Error('FakeProvider script exhausted'));
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- scripts may throw anything, like a provider
    if ('error' in step) return Promise.reject(step.error);
    const blocked = step.blocked ?? false;
    return Promise.resolve({
      text: step.text,
      inputTokens: step.inputTokens ?? tokens(request.system + request.user),
      outputTokens: step.outputTokens ?? tokens(step.text),
      finishReason: step.finishReason ?? (blocked ? 'safety' : 'stop'),
      blocked,
    });
  }

  private sample(request: LlmRequest): FakeStep {
    return { text: JSON.stringify(sampleFromJsonSchema(request.responseJsonSchema)) };
  }
}
