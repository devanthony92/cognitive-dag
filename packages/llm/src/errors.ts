import type { ErrorClass } from '@cognitive-dag/dag-schema';

/** Codes of the LLM nodes and the class each one belongs to (research R15). */
export const LLM_ERROR_CLASSES = {
  LLM_INVALID_OUTPUT: 'invalid_output',
  LLM_CONTENT_BLOCKED: 'invalid_output',
  LLM_CANARY_LEAK: 'invalid_output',
  LLM_RUN_BUDGET_EXHAUSTED: 'budget_exhausted',
  LLM_DAILY_BUDGET_EXHAUSTED: 'budget_exhausted',
  LLM_INPUT_TOO_LARGE: 'permanent',
  LLM_EMPTY_INPUT: 'permanent',
  LLM_DISABLED: 'permanent',
  LLM_PROVIDER_REJECTED: 'permanent',
  LLM_PROVIDER_UNAVAILABLE: 'transient',
  LLM_PROVIDER_RATE_LIMITED: 'rate_limited',
} as const satisfies Record<string, ErrorClass>;

export type LlmErrorCode = keyof typeof LLM_ERROR_CLASSES;

/** Tokens spent by the calls that happened before a failure. */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * A failure of an LLM node, already in the taxonomy of F4/F5. Its message is in Spanish and never
 * carries the text of the prompt, of the answer or of the provider error.
 */
export class LlmError extends Error {
  readonly errorClass: ErrorClass;
  /** Tokens spent before the failure, so the budget can be settled. */
  usage?: LlmUsage;
  /** Repairs attempted before the failure. */
  repairs?: number;
  /**
   * Last answer that passed the schema but failed the extra check, on `LLM_INVALID_OUTPUT` (F6,
   * research R9): the compiler offers it as a draft. Never logged.
   */
  lastValue?: unknown;
  /** Wait asked by the provider, when it said so. */
  retryAfterMs?: number;

  readonly code: LlmErrorCode;

  constructor(code: LlmErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'LlmError';
    this.errorClass = LLM_ERROR_CLASSES[code];
  }
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * Translates what the provider throws to the taxonomy. The provider message is dropped on
 * purpose: it can echo the prompt or the key.
 */
export function translateProviderError(error: unknown): LlmError {
  if (error instanceof LlmError) return error;
  const status = statusOf(error);
  if (status === 429) {
    return new LlmError(
      'LLM_PROVIDER_RATE_LIMITED',
      'El proveedor de IA limitó las solicitudes; se reintentará.',
    );
  }
  if (status !== undefined && status >= 400 && status < 500 && status !== 408) {
    return new LlmError('LLM_PROVIDER_REJECTED', 'El proveedor de IA rechazó la solicitud.');
  }
  return new LlmError('LLM_PROVIDER_UNAVAILABLE', 'El proveedor de IA no está disponible.');
}
