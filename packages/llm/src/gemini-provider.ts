import { GoogleGenAI, type GenerateContentParameters } from '@google/genai';
import type { FinishReason, LlmProvider, LlmRequest, LlmResponse } from './provider.js';

/** The part of the SDK client the provider uses: tests give it a stand-in. */
export interface GeminiClient {
  models: {
    generateContent(params: GenerateContentParameters): Promise<{
      text?: string;
      candidates?: { finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    }>;
  };
}

const SAFETY_REASONS = new Set([
  'SAFETY',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'IMAGE_SAFETY',
  'RECITATION',
]);

function finishReasonOf(reason: string | undefined): FinishReason {
  if (reason === undefined || reason === 'STOP') return 'stop';
  if (reason === 'MAX_TOKENS') return 'max_tokens';
  if (SAFETY_REASONS.has(reason)) return 'safety';
  return 'other';
}

/**
 * Provider over `@google/genai` (ADR of the `llm` package). Structured output goes through
 * `responseMimeType` and `responseJsonSchema`. It throws the SDK's own errors: the guard
 * translates them (`translateProviderError`). The key is only handed to the SDK and never logged.
 */
export class GeminiProvider implements LlmProvider {
  private readonly client: GeminiClient;

  constructor(options: { apiKey: string } | { client: GeminiClient }) {
    this.client =
      'client' in options ? options.client : new GoogleGenAI({ apiKey: options.apiKey });
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    const contents: GenerateContentParameters['contents'] = [
      { role: 'user', parts: [{ text: request.user }] },
    ];
    if (request.repair) {
      contents.push(
        { role: 'model', parts: [{ text: request.repair.previousOutput }] },
        {
          role: 'user',
          parts: [
            {
              text:
                'Your previous answer was rejected. Fix these problems and answer again with ' +
                `a JSON object that follows the schema:\n${request.repair.errors.join('\n')}`,
            },
          ],
        },
      );
    }
    const response = await this.client.models.generateContent({
      model: request.model,
      contents,
      config: {
        systemInstruction: request.system,
        responseMimeType: 'application/json',
        responseJsonSchema: request.responseJsonSchema,
        maxOutputTokens: request.maxOutputTokens,
      },
    });
    const finishReason = finishReasonOf(response.candidates?.[0]?.finishReason);
    const blocked = response.promptFeedback?.blockReason !== undefined || finishReason === 'safety';
    return {
      text: response.text ?? '',
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      finishReason,
      blocked,
    };
  }
}
