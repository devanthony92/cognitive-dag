import { z } from 'zod';

/** Bounds of the per-node retry setting (FR-006). */
export const RETRY_LIMITS = {
  maxAttempts: { min: 1, max: 10 },
  timeoutSeconds: { min: 1, max: 120 },
  initialIntervalMs: { min: 100, max: 30_000 },
} as const;

/** Labels the editor and the validation messages use for the retry fields. */
export const RETRY_FIELD_LABELS: Readonly<Record<string, string>> = {
  maxAttempts: 'Intentos máximos',
  timeoutSeconds: 'Tiempo máximo por intento (s)',
  initialIntervalMs: 'Espera inicial (ms)',
};

/** Complete policy of a node: what the interpreter applies (research R2). */
export interface RetryPolicy {
  maxAttempts: number;
  timeoutSeconds: number;
  initialIntervalMs: number;
}

/** The `retry` setting of a node: any field left out takes the default of the node type. */
export const RetrySettingSchema = z.strictObject({
  maxAttempts: z
    .int()
    .min(RETRY_LIMITS.maxAttempts.min)
    .max(RETRY_LIMITS.maxAttempts.max)
    .optional(),
  timeoutSeconds: z
    .int()
    .min(RETRY_LIMITS.timeoutSeconds.min)
    .max(RETRY_LIMITS.timeoutSeconds.max)
    .optional(),
  initialIntervalMs: z
    .int()
    .min(RETRY_LIMITS.initialIntervalMs.min)
    .max(RETRY_LIMITS.initialIntervalMs.max)
    .optional(),
});

export type RetrySetting = z.infer<typeof RetrySettingSchema>;
