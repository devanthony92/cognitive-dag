import type { JsonSchema } from './schema.js';

/** The answer of the model to a rejected one: what was wrong, never the user text. */
export interface RepairTurn {
  previousOutput: string;
  errors: readonly string[];
}

export interface LlmRequest {
  model: string;
  system: string;
  user: string;
  responseJsonSchema: JsonSchema;
  maxOutputTokens: number;
  /** Present from the second call of a guarded run on. */
  repair?: RepairTurn;
}

export type FinishReason = 'stop' | 'max_tokens' | 'safety' | 'other';

export interface LlmResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  finishReason: FinishReason;
  /** The provider refused to answer (prompt or answer blocked by its safety filters). */
  blocked: boolean;
}

/**
 * What the engine needs from a model provider (research R2). Implementations return a response or
 * throw; `translateProviderError` maps whatever they throw to the taxonomy.
 */
export interface LlmProvider {
  generate(request: LlmRequest): Promise<LlmResponse>;
}
