/** Tokens reserved before a call (research R4): `ceil(chars / 4)` of the prompt plus the output cap. */
export function estimateReservation(inputChars: number, maxOutputTokens: number): number {
  return Math.ceil(inputChars / 4) + maxOutputTokens;
}

export type OutputCapSpec =
  | { kind: 'classify' }
  | { kind: 'extract'; fieldCount: number }
  | { kind: 'generate'; maxLength: number };

const CLASSIFY_MAX_OUTPUT_TOKENS = 128;
const EXTRACT_BASE_TOKENS = 256;
const EXTRACT_TOKENS_PER_FIELD = 128;
const EXTRACT_MAX_OUTPUT_TOKENS = 4096;
/** The JSON wrapper around a generated text: `{"text":"..."}`. */
const GENERATE_WRAPPER_TOKENS = 32;

/**
 * Cap of output tokens per node type. A generation derives it from `maxLength`: the text may need
 * up to two characters per token (accents, non-English), so the cap never cuts a valid answer.
 */
export function maxOutputTokensFor(spec: OutputCapSpec): number {
  switch (spec.kind) {
    case 'classify':
      return CLASSIFY_MAX_OUTPUT_TOKENS;
    case 'extract':
      return Math.min(
        EXTRACT_BASE_TOKENS + EXTRACT_TOKENS_PER_FIELD * spec.fieldCount,
        EXTRACT_MAX_OUTPUT_TOKENS,
      );
    case 'generate':
      return Math.ceil(spec.maxLength / 2) + GENERATE_WRAPPER_TOKENS;
  }
}

/** Price of a model in micro-USD per million tokens. */
export interface ModelPrice {
  input: number;
  output: number;
}

export type Prices = ReadonlyMap<string, ModelPrice>;

export interface PriceParseResult {
  prices: Prices;
  /** True when the value is malformed; the value itself is never reported. */
  invalid: boolean;
}

/** Parses `LLM_PRICES=<model>:<input>:<output>;...` (research R4). */
export function parsePrices(value: string | undefined): PriceParseResult {
  const prices = new Map<string, ModelPrice>();
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') return { prices, invalid: false };
  for (const entry of trimmed.split(';')) {
    const match = /^([^:;\s]+):(\d+):(\d+)$/.exec(entry.trim());
    if (!match || prices.has(match[1]!)) return { prices: new Map(), invalid: true };
    prices.set(match[1]!, { input: Number(match[2]), output: Number(match[3]) });
  }
  return { prices, invalid: false };
}

/** Estimated cost of a call in micro-USD, rounded up. A model without a price costs 0. */
export function costMicroUsd(
  prices: Prices,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = prices.get(model);
  if (!price) return 0;
  return Math.ceil((inputTokens * price.input + outputTokens * price.output) / 1_000_000);
}

/** Models in use that have no price: the worker warns about them at startup. */
export function modelsWithoutPrice(models: readonly string[], prices: Prices): string[] {
  return [...new Set(models)].filter((model) => !prices.has(model));
}
