import { z } from 'zod';
import { ErrorClassSchema } from './runs.js';
import { DraftValidationSchema } from './workflows.js';

/** Name of the Temporal workflow of a compilation; its id is `compile-<compilationId>`. */
export const COMPILE_INTENT_WORKFLOW_NAME = 'compileIntent';

/** Longest intent the compiler accepts (F6, research R13). */
export const COMPILER_INTENT_MAX_CHARS = 2000;

/** Codes a failed compilation records besides the LLM ones, and the class of each. */
export const COMPILER_ERROR_CODES = {
  COMPILER_INVALID_DAG: 'invalid_output',
  COMPILER_BUDGET_EXHAUSTED: 'budget_exhausted',
  COMPILER_EMPTY_INTENT: 'permanent',
  COMPILER_INTENT_TOO_LONG: 'permanent',
} as const;
export type CompilerErrorCode = keyof typeof COMPILER_ERROR_CODES;

/** `POST /organizations/{organizationId}/compilations`. Without `workflowId`: mode `create`. */
export const CreateCompilationRequestSchema = z.strictObject({
  intent: z
    .string()
    .trim()
    .min(1, 'Describe qué quieres automatizar.')
    .max(
      COMPILER_INTENT_MAX_CHARS,
      `Debe tener como máximo ${COMPILER_INTENT_MAX_CHARS} caracteres.`,
    ),
  workflowId: z.uuid().optional(),
});
export type CreateCompilationRequest = z.infer<typeof CreateCompilationRequestSchema>;

export const CompilationModeSchema = z.enum(['create', 'regenerate']);
export type CompilationMode = z.infer<typeof CompilationModeSchema>;

export const CompilationStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed']);
export type CompilationStatus = z.infer<typeof CompilationStatusSchema>;

/** A compilation as the API returns it: status and metrics, never the intent or the DAG. */
export const CompilationSchema = z.object({
  id: z.uuid(),
  workflowId: z.uuid().nullable(),
  mode: CompilationModeSchema,
  baseDraftRevision: z.int().min(1).nullable(),
  status: CompilationStatusSchema,
  model: z.string(),
  calls: z.int().min(0).max(3),
  repairs: z.int().min(0).max(2),
  tokensUsed: z.int().min(0),
  costMicroUsd: z.int().min(0),
  nodeCount: z.int().min(0).nullable(),
  hasFallback: z.boolean(),
  errorClass: ErrorClassSchema.nullable(),
  errorCode: z.string().nullable(),
  requestedBy: z.uuid(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});
export type Compilation = z.infer<typeof CompilationSchema>;

export const CompilationListSchema = z.object({ items: z.array(CompilationSchema).max(20) });
export type CompilationList = z.infer<typeof CompilationListSchema>;

export const OmittedSensitiveFieldSchema = z.strictObject({
  nodeId: z.string(),
  field: z.string(),
});
export type OmittedSensitiveField = z.infer<typeof OmittedSensitiveFieldSchema>;

/**
 * `GET /compilations/{id}/result`, read from the Temporal history: the DAG of a successful
 * compilation (`result`) or the last attempt of a failed one (`fallback`, research R9).
 */
export const CompilationResultSchema = z.strictObject({
  kind: z.enum(['result', 'fallback']),
  /** Name proposed for a new workflow. */
  title: z.string().min(1).max(100),
  /** A `DagDefinition` of F2; validated by `@cognitive-dag/dag-schema` where it is used. */
  definition: z.record(z.string(), z.unknown()),
  validation: DraftValidationSchema,
  omittedSensitiveFields: z.array(OmittedSensitiveFieldSchema),
});
export type CompilationResult = z.infer<typeof CompilationResultSchema>;

/** Input of the `compileIntent` workflow (`compile-<compilationId>`, research R2, R10). */
export const CompileIntentInputSchema = z.strictObject({
  compilationId: z.uuid(),
  organizationId: z.uuid(),
  correlationId: z.uuid(),
  intent: z.string().min(1).max(COMPILER_INTENT_MAX_CHARS),
  /** Node types the compiler may use, resolved by the API from the phase and the flags. */
  allowedTypes: z.array(z.string().min(1).max(64)).min(1).max(50),
  /** Queue of the LLM activities: the workflow cannot read the environment. */
  llmTaskQueue: z.string().min(1).max(255),
});
export type CompileIntentInput = z.infer<typeof CompileIntentInputSchema>;

/** Value returned by `compileIntent`: the result or the fallback, if any. Content stays in Temporal. */
export const CompileIntentResultSchema = z.object({
  status: z.enum(['succeeded', 'failed']),
  result: CompilationResultSchema.nullable(),
  errorCode: z.string().nullable(),
  errorClass: ErrorClassSchema.nullable(),
});
export type CompileIntentResult = z.infer<typeof CompileIntentResultSchema>;
