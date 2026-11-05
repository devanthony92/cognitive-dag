import { z } from 'zod';

/**
 * Consumption of the LLM nodes (F5, research R12): sums of `llm_calls`. On a step it carries the
 * model (null when the calls used several); on a run it does not.
 */
export const LlmUsageSchema = z.strictObject({
  calls: z.int().min(0),
  model: z.string().nullable().optional(),
  inputTokens: z.int().min(0),
  outputTokens: z.int().min(0),
  /** Estimated cost in millionths of a US dollar. */
  costMicroUsd: z.int().min(0),
  repairs: z.int().min(0),
});
export type LlmUsage = z.infer<typeof LlmUsageSchema>;

/** `GET /organizations/{organizationId}/llm-usage/today`. */
export const LlmDailyUsageSchema = z.strictObject({
  /** UTC day. */
  date: z.iso.date(),
  /** Includes the reservations in progress. */
  tokensUsed: z.int().min(0),
  tokensLimit: z.int().min(1),
  costMicroUsd: z.int().min(0),
});
export type LlmDailyUsage = z.infer<typeof LlmDailyUsageSchema>;

/** Codes the LLM nodes record on a failed step, and the class of each (research R15). */
export const LLM_ERROR_CODES = {
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
} as const;

export type LlmErrorCode = keyof typeof LLM_ERROR_CODES;
