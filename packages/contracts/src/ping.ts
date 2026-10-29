import { z } from 'zod';
import { CorrelationIdSchema } from './correlation.js';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

export const IdempotencyKeySchema = z.uuid();

export const PingIdSchema = z.string().regex(/^ping-[0-9a-f-]{36}$/);

export type PingId = z.infer<typeof PingIdSchema>;

export const CreatePingRequestSchema = z.strictObject({
  message: z
    .string()
    .min(1, 'Debe tener entre 1 y 100 caracteres.')
    .max(100, 'Debe tener entre 1 y 100 caracteres.')
    .regex(/^\P{Cc}+$/u, 'No puede contener caracteres de control.')
    .optional(),
});

export type CreatePingRequest = z.infer<typeof CreatePingRequestSchema>;

export const PingStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'timed_out']);

export type PingStatus = z.infer<typeof PingStatusSchema>;

export const TERMINAL_PING_STATUSES: readonly PingStatus[] = ['completed', 'failed', 'timed_out'];

export const PingResultSchema = z.object({
  pong: z.string(),
  workerId: z.string(),
  attempts: z.int().min(1),
});

export type PingResult = z.infer<typeof PingResultSchema>;

export const PingExecutionSchema = z.object({
  pingId: PingIdSchema,
  correlationId: CorrelationIdSchema,
  status: PingStatusSchema,
  result: PingResultSchema.optional(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().optional(),
});

export type PingExecution = z.infer<typeof PingExecutionSchema>;

/** Input of the ping workflow and activity. */
export const PingWorkflowInputSchema = z.object({
  correlationId: CorrelationIdSchema,
  message: z.string().optional(),
});

export type PingWorkflowInput = z.infer<typeof PingWorkflowInputSchema>;
