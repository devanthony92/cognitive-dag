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
  'WORKFLOW_NOT_RUNNABLE',
  'RUN_INPUT_INVALID',
  'RUN_LIMIT_REACHED',
  'RUN_NOT_CANCELLABLE',
  'RUN_INPUT_EXPIRED',
  'STEP_IO_EXPIRED',
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
    /** Why a workflow cannot run; only with WORKFLOW_NOT_RUNNABLE (F3). */
    reason: z.enum(['no_active_version', 'archived', 'unsupported_nodes']).optional(),
    /** Nodes that block a run; only with WORKFLOW_NOT_RUNNABLE and `unsupported_nodes` (F3). */
    nodes: z
      .array(z.strictObject({ nodeId: z.string(), type: z.string(), executableFrom: z.string() }))
      .optional(),
  })
  .refine(
    (problem) =>
      problem.retryAfterSeconds === undefined ||
      problem.code === 'RATE_LIMITED' ||
      problem.code === 'RUN_LIMIT_REACHED',
    {
      error: 'retryAfterSeconds solo se admite con RATE_LIMITED o RUN_LIMIT_REACHED.',
      path: ['retryAfterSeconds'],
    },
  )
  .refine(
    (problem) =>
      (problem.reason === undefined && problem.nodes === undefined) ||
      problem.code === 'WORKFLOW_NOT_RUNNABLE',
    { error: 'reason y nodes solo se admiten con WORKFLOW_NOT_RUNNABLE.', path: ['reason'] },
  )
  .refine((problem) => problem.dagErrors === undefined || problem.code === 'DAG_INVALID', {
    error: 'dagErrors solo se admite con DAG_INVALID.',
    path: ['dagErrors'],
  });

export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;
