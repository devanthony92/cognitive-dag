import { z } from 'zod';
import { CorrelationIdSchema } from './correlation.js';
import { DagErrorSchema } from './workflows.js';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export const ProblemCodeSchema = z.enum([
  'VALIDATION_FAILED',
  'PAYLOAD_TOO_LARGE',
  'ROUTE_NOT_FOUND',
  'PING_NOT_FOUND',
  'FEATURE_NOT_AVAILABLE',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'CSRF_REJECTED',
  'FORBIDDEN',
  'NOT_FOUND',
  'RATE_LIMITED',
  'TOKEN_INVALID',
  'ALREADY_MEMBER',
  'LAST_OWNER',
  'WORKFLOW_NAME_TAKEN',
  'DRAFT_CONFLICT',
  'PRECONDITION_REQUIRED',
  'DAG_INVALID',
  'LIMIT_EXCEEDED',
]);

export type ProblemCode = z.infer<typeof ProblemCodeSchema>;

export const FieldErrorSchema = z.strictObject({
  field: z.string(),
  message: z.string(),
});

export type FieldError = z.infer<typeof FieldErrorSchema>;

/** RFC 9457 problem details without `type` and `instance` (constitution, principle V). */
export const ProblemDetailsSchema = z
  .strictObject({
    status: z.int().min(400).max(599),
    title: z.string(),
    detail: z.string(),
    code: ProblemCodeSchema,
    correlationId: CorrelationIdSchema,
    errors: z.array(FieldErrorSchema).optional(),
    /** Validation errors of the DAG; only with DAG_INVALID (F2). */
    dagErrors: z.array(DagErrorSchema).optional(),
    /** Seconds to wait before retrying; only meaningful for RATE_LIMITED (FR-015). */
    retryAfterSeconds: z.int().min(1).optional(),
  })
  .refine((problem) => problem.retryAfterSeconds === undefined || problem.code === 'RATE_LIMITED', {
    error: 'retryAfterSeconds solo se admite con RATE_LIMITED.',
    path: ['retryAfterSeconds'],
  })
  .refine((problem) => problem.dagErrors === undefined || problem.code === 'DAG_INVALID', {
    error: 'dagErrors solo se admite con DAG_INVALID.',
    path: ['dagErrors'],
  });

export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;
