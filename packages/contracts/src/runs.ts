import { z } from 'zod';
import { CorrelationIdSchema } from './correlation.js';

export const EXECUTE_DAG_WORKFLOW_NAME = 'executeDag';

/** Default longest a run may take (research R1). The interpreter enforces it itself. */
export const DEFAULT_RUN_MAX_DURATION_MS = 30 * 60 * 1000;

/**
 * Hard backstop for `workflowExecutionTimeout` when starting a run: a little over the longest
 * duration the interpreter allows, so the interpreter records `timed_out` before Temporal stops it.
 */
export const RUN_EXECUTION_TIMEOUT = '31 minutes';

export const RUN_ID_PREFIX = 'run-';

/** Id of the Temporal workflow of a run (research R6). */
export const temporalWorkflowIdFor = (runId: string): string => `${RUN_ID_PREFIX}${runId}`;

/** Valkey pub/sub channel with the live events of one run (research R3, R4). */
export const runChannel = (runId: string): string => `run:${runId}`;

/**
 * Input of the interpreter workflow. The definition travels whole and never changes during the
 * run (FR-003); the workflow checks it against `@cognitive-dag/dag-schema`, the single authority
 * on its shape. Contents of the trigger input live only in the Temporal history (decision 5C).
 */
export const ExecuteDagInputSchema = z.strictObject({
  organizationId: z.uuid(),
  workflowId: z.uuid(),
  versionId: z.uuid(),
  versionNumber: z.int().min(1),
  runId: z.uuid(),
  correlationId: CorrelationIdSchema,
  definition: z.record(z.string(), z.unknown()),
  triggerInput: z.record(z.string(), z.unknown()),
  maxDurationMs: z.int().min(1).max(86_400_000).optional(),
});

export type ExecuteDagInput = z.infer<typeof ExecuteDagInputSchema>;

export const RunStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const FINAL_RUN_STATUSES = ['succeeded', 'failed', 'cancelled', 'timed_out'] as const;
export type FinalRunStatus = (typeof FINAL_RUN_STATUSES)[number];

export const StepStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'skipped',
  'cancelled',
]);
export type StepStatus = z.infer<typeof StepStatusSchema>;

export const ExecuteDagResultSchema = z.object({
  status: z.literal('succeeded'),
  outputs: z.record(z.string(), z.unknown()),
});
export type ExecuteDagResult = z.infer<typeof ExecuteDagResultSchema>;

/** Stable error codes the interpreter records on a run or a step. */
export const RUN_ERROR_CODES = {
  invalidDefinition: 'INVALID_DEFINITION',
  unsupportedNodes: 'UNSUPPORTED_NODES',
  timedOut: 'RUN_TIMED_OUT',
  internal: 'INTERNAL_ERROR',
} as const;

/** Longest `error_message` the database accepts. */
export const RUN_ERROR_MESSAGE_MAX = 500;
export const RUN_ERROR_CODE_MAX = 64;

const ErrorSummarySchema = z.object({
  errorCode: z.string().min(1).max(RUN_ERROR_CODE_MAX).optional(),
  errorMessage: z.string().min(1).max(RUN_ERROR_MESSAGE_MAX).optional(),
});

const NodeRefSchema = z.object({
  nodeId: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  nodeType: z.string().min(1).max(40),
});

const EventBaseSchema = z.object({
  organizationId: z.uuid(),
  runId: z.uuid(),
  correlationId: CorrelationIdSchema,
  /** Workflow clock at the moment of the transition (deterministic across replays). */
  at: z.iso.datetime(),
});

/**
 * One state change the interpreter asks the `recordRunEvent` activity to persist. The key of the
 * write is `(runId, nodeId, transition)`: repeating an event never duplicates or regresses a row.
 */
export const RunEventSchema = z.discriminatedUnion('transition', [
  EventBaseSchema.extend({
    transition: z.literal('run.started'),
    /** Every node of the version: their steps start as `pending`. */
    nodes: z.array(NodeRefSchema).max(500),
  }),
  EventBaseSchema.extend({
    transition: z.literal('run.finished'),
    status: z.enum(FINAL_RUN_STATUSES),
    ...ErrorSummarySchema.shape,
  }),
  EventBaseSchema.extend({ transition: z.literal('step.running') }).extend(NodeRefSchema.shape),
  EventBaseSchema.extend({
    transition: z.enum(['step.succeeded', 'step.failed', 'step.skipped', 'step.cancelled']),
    attempts: z.int().min(0).max(1000).optional(),
    durationMs: z.int().min(0).optional(),
    ...ErrorSummarySchema.shape,
  }).extend(NodeRefSchema.shape),
]);

export type RunEvent = z.infer<typeof RunEventSchema>;
export type RunTransition = RunEvent['transition'];

/** What reaches the browser through Valkey: the state after the transition, never data content. */
export const RunLiveEventSchema = z.object({
  runId: z.uuid(),
  correlationId: CorrelationIdSchema,
  transition: z.string(),
  at: z.iso.datetime(),
  runStatus: RunStatusSchema.optional(),
  nodeId: z.string().optional(),
  nodeType: z.string().optional(),
  stepStatus: StepStatusSchema.optional(),
  attempts: z.int().optional(),
  durationMs: z.int().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
});
export type RunLiveEvent = z.infer<typeof RunLiveEventSchema>;
