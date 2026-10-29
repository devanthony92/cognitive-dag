import { z } from 'zod';

export const CORRELATION_ID_HEADER = 'X-Correlation-Id';

export const CorrelationIdSchema = z.uuid().max(36);

export type CorrelationId = z.infer<typeof CorrelationIdSchema>;

/**
 * Returns the incoming correlation id when it is a valid UUID; otherwise a new v4 UUID.
 * Untrusted values are never echoed back, which keeps them out of logs and headers.
 */
export function resolveCorrelationId(input: unknown): CorrelationId {
  const parsed = CorrelationIdSchema.safeParse(input);
  return parsed.success ? parsed.data : globalThis.crypto.randomUUID();
}
