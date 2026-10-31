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

/**
 * Taxonomy of node failures (research R1). The rules that use it live in `@cognitive-dag/dag-schema`;
 * this is the wire format, and the worker keeps both lists in sync under test.
 */
export const ErrorClassSchema = z.enum(['transient', 'rate_limited', 'timeout', 'permanent']);
export type ErrorClass = z.infer<typeof ErrorClassSchema>;

/** Why a running step is not progressing. */
export const WaitingReasonSchema = z.enum(['rate_limited']);
export type WaitingReason = z.infer<typeof WaitingReasonSchema>;

export const FINAL_RUN_STATUSES = ['succeeded', 'failed', 'cancelled', 'timed_out'] as const;
export type FinalRunStatus = (typeof FINAL_RUN_STATUSES)[number];

export const StepStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'skipped',
  'cancelled',
  'reused',
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
  errorClass: ErrorClassSchema.optional(),
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
  EventBaseSchema.extend({
    transition: z.literal('step.running'),
    /** Set while the step waits for the rate limit; a later `step.running` without it clears it. */
    waitingReason: WaitingReasonSchema.optional(),
  }).extend(NodeRefSchema.shape),
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
  waitingReason: WaitingReasonSchema.optional(),
  errorClass: ErrorClassSchema.optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
});
export type RunLiveEvent = z.infer<typeof RunLiveEventSchema>;

/** Runs in progress allowed when the organization has no limits of its own (research R5). */
export const DEFAULT_MAX_CONCURRENT_RUNS = 5;

/** Body of `POST .../workflows/{workflowId}/runs`: the fields declared by `trigger.manual`. */
export const StartRunRequestSchema = z.strictObject({
  input: z.record(z.string(), z.unknown()),
});
export type StartRunRequest = z.infer<typeof StartRunRequestSchema>;

const ErrorBodySchema = z.object({
  code: z.string(),
  message: z.string(),
  class: ErrorClassSchema.optional(),
});

export const RunSchema = z.object({
  id: z.uuid(),
  workflowId: z.uuid(),
  versionNumber: z.int().min(1),
  status: RunStatusSchema,
  triggeredBy: z.object({ id: z.uuid(), name: z.string() }),
  rerunOf: z.uuid().nullable(),
  /** Node a rerun started from; null for a complete run or a complete rerun. */
  rerunFromNodeId: z.string().nullable(),
  correlationId: CorrelationIdSchema,
  error: ErrorBodySchema.nullable(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
});
export type Run = z.infer<typeof RunSchema>;

export const RunStepSchema = z.object({
  nodeId: z.string(),
  nodeType: z.string(),
  status: StepStatusSchema,
  attempts: z.int().min(0),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  durationMs: z.int().min(0).nullable(),
  error: ErrorBodySchema.nullable(),
  waitingReason: WaitingReasonSchema.nullable(),
});
export type RunStep = z.infer<typeof RunStepSchema>;

export const RunDetailSchema = RunSchema.extend({
  steps: z.array(RunStepSchema),
  definition: z.record(z.string(), z.unknown()),
});
export type RunDetail = z.infer<typeof RunDetailSchema>;

export const RunListSchema = z.object({
  items: z.array(RunSchema),
  nextCursor: z.string().nullable(),
});
export type RunList = z.infer<typeof RunListSchema>;

/** Content of a step read from the Temporal history; sensitive keys are redacted. */
export const StepIoSchema = z.object({
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  truncated: z.boolean(),
});
export type StepIo = z.infer<typeof StepIoSchema>;

/** One Server-Sent Event of `GET .../runs/{runId}/events`. */
export const RunStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('snapshot'), run: RunSchema, steps: z.array(RunStepSchema) }),
  z.object({ type: z.literal('run'), run: RunSchema }),
  z.object({ type: z.literal('step'), step: RunStepSchema }),
]);
export type RunStreamEvent = z.infer<typeof RunStreamEventSchema>;
