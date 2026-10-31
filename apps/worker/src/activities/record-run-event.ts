import { ApplicationFailure } from '@temporalio/activity';
import {
  and,
  eq,
  inArray,
  sql,
  workflowRunSteps,
  workflowRuns,
  type Tx,
  type WithContext,
} from '@cognitive-dag/db';
import {
  RunEventSchema,
  runChannel,
  type RunEvent,
  type RunLiveEvent,
  type RunStatus,
  type StepStatus,
} from '@cognitive-dag/contracts';
import type { Logger } from '@cognitive-dag/logger';

export interface RunEventActivities {
  recordRunEvent(event: RunEvent): Promise<void>;
}

export interface RunEventActivityOptions {
  withContext: WithContext;
  /** Publishes a message on a Valkey channel. Live events are best effort: Postgres is the record. */
  publish(channel: string, message: string): Promise<unknown>;
  logger: Logger;
}

const STEP_STATUS: Record<string, StepStatus> = {
  'step.running': 'running',
  'step.succeeded': 'succeeded',
  'step.failed': 'failed',
  'step.skipped': 'skipped',
  'step.cancelled': 'cancelled',
};

/** States a step can still leave: a repeated or late write never moves a finished step. */
const OPEN_STEP_STATES = ['pending', 'running'] as const;

type StepEvent = Exclude<RunEvent, { transition: 'run.started' | 'run.finished' }>;

async function runStarted(
  tx: Tx,
  event: Extract<RunEvent, { transition: 'run.started' }>,
): Promise<void> {
  const at = new Date(event.at);
  const updated = await tx
    .update(workflowRuns)
    .set({ status: 'running', startedAt: at })
    .where(and(eq(workflowRuns.id, event.runId), eq(workflowRuns.status, 'queued')))
    .returning({ id: workflowRuns.id });
  if (updated.length === 0) {
    const existing = await tx
      .select({ id: workflowRuns.id })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, event.runId));
    // The API inserts the run before starting the workflow; retrying cannot create it.
    if (existing.length === 0) {
      throw ApplicationFailure.create({
        type: 'RUN_NOT_FOUND',
        message: 'The run record does not exist in this organization.',
        nonRetryable: true,
      });
    }
  }
  if (event.nodes.length > 0) {
    await tx
      .insert(workflowRunSteps)
      .values(
        event.nodes.map((node) => ({
          organizationId: event.organizationId,
          runId: event.runId,
          nodeId: node.nodeId,
          nodeType: node.nodeType,
          status: 'pending' as const,
        })),
      )
      .onConflictDoNothing({ target: [workflowRunSteps.runId, workflowRunSteps.nodeId] });
  }
}

async function runFinished(
  tx: Tx,
  event: Extract<RunEvent, { transition: 'run.finished' }>,
): Promise<void> {
  await tx
    .update(workflowRuns)
    .set({
      status: event.status,
      errorCode: event.errorCode ?? null,
      errorMessage: event.errorMessage ?? null,
      finishedAt: new Date(event.at),
    })
    .where(
      and(eq(workflowRuns.id, event.runId), inArray(workflowRuns.status, ['queued', 'running'])),
    );
}

async function stepChanged(tx: Tx, event: StepEvent): Promise<void> {
  const status = STEP_STATUS[event.transition] as StepStatus;
  const at = new Date(event.at);
  const skipped = event.transition === 'step.skipped';
  // `step.running` carries no outcome; every other transition is final for the step.
  const outcome = event.transition === 'step.running' ? undefined : event;
  const values = {
    organizationId: event.organizationId,
    runId: event.runId,
    nodeId: event.nodeId,
    nodeType: event.nodeType,
    status,
    attempts: outcome?.attempts ?? 0,
    startedAt: skipped ? null : at,
    finishedAt: outcome ? at : null,
    durationMs: outcome?.durationMs ?? null,
    errorCode: outcome?.errorCode ?? null,
    errorMessage: outcome?.errorMessage ?? null,
  };
  await tx
    .insert(workflowRunSteps)
    .values(values)
    .onConflictDoUpdate({
      target: [workflowRunSteps.runId, workflowRunSteps.nodeId],
      set: {
        status,
        nodeType: event.nodeType,
        startedAt: skipped
          ? null
          : sql`coalesce(${workflowRunSteps.startedAt}, ${at.toISOString()}::timestamptz)`,
        finishedAt: values.finishedAt,
        attempts: sql`greatest(${workflowRunSteps.attempts}, ${values.attempts})`,
        durationMs: values.durationMs,
        errorCode: values.errorCode,
        errorMessage: values.errorMessage,
      },
      setWhere: inArray(workflowRunSteps.status, [...OPEN_STEP_STATES]),
    });
}

function liveEventFor(event: RunEvent): RunLiveEvent {
  const base = {
    runId: event.runId,
    correlationId: event.correlationId,
    transition: event.transition,
    at: event.at,
  };
  switch (event.transition) {
    case 'run.started':
      return { ...base, runStatus: 'running' satisfies RunStatus };
    case 'run.finished':
      return {
        ...base,
        runStatus: event.status,
        ...(event.errorCode ? { errorCode: event.errorCode } : {}),
        ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
      };
    case 'step.running':
      return {
        ...base,
        nodeId: event.nodeId,
        nodeType: event.nodeType,
        stepStatus: 'running',
      };
    default:
      return {
        ...base,
        nodeId: event.nodeId,
        nodeType: event.nodeType,
        stepStatus: STEP_STATUS[event.transition],
        ...(event.attempts === undefined ? {} : { attempts: event.attempts }),
        ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
        ...(event.errorCode ? { errorCode: event.errorCode } : {}),
        ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
      };
  }
}

/**
 * Writes the state changes of a run to Postgres as `app_runtime`, in the context of the
 * organization carried by the workflow input, and announces them on `run:<runId>` (research R3).
 *
 * Idempotent per `(run_id, node_id, transition)`: every write is an upsert that only moves a row
 * forward (pending, running, final), so Temporal retrying the activity, or replaying it after a
 * crash, never duplicates or regresses a row. No input or output content is ever written.
 */
export function createRunEventActivities(options: RunEventActivityOptions): RunEventActivities {
  return {
    async recordRunEvent(rawEvent) {
      const event = RunEventSchema.parse(rawEvent);
      const log = options.logger.child({
        correlationId: event.correlationId,
        runId: event.runId,
        transition: event.transition,
      });

      await options.withContext({ organizationId: event.organizationId }, async (tx) => {
        switch (event.transition) {
          case 'run.started':
            return runStarted(tx, event);
          case 'run.finished':
            return runFinished(tx, event);
          default:
            return stepChanged(tx, event);
        }
      });
      log.info('Run event recorded');

      try {
        await options.publish(runChannel(event.runId), JSON.stringify(liveEventFor(event)));
      } catch (error) {
        // The live view recovers from the database snapshot; a lost event must not fail the run.
        log.warn({ err: error }, 'Could not publish the live run event');
      }
    },
  };
}
