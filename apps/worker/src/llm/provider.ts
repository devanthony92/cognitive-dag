import { FakeProvider, GeminiProvider, type LlmProvider } from '@cognitive-dag/llm';

/** Provider selected by `LLM_PROVIDER`; the key goes only to the SDK and is never logged. */
export function createProvider(config: {
  LLM_PROVIDER: 'fake' | 'gemini';
  GEMINI_API_KEY?: string | undefined;
}): LlmProvider {
  if (config.LLM_PROVIDER === 'gemini') {
    return new GeminiProvider({ apiKey: config.GEMINI_API_KEY ?? '' });
  }
  return new FakeProvider();
}
