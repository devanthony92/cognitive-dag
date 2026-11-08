import {
  ApplicationFailure,
  ParentClosePolicy,
  proxyActivities,
  startChild,
  uuid4,
  workflowInfo,
} from '@temporalio/workflow';
import { z } from 'zod';
import { EXECUTE_DAG_WORKFLOW_NAME } from '@cognitive-dag/contracts';
import type { RunEventActivities } from '../activities/record-run-event';
import type { ScheduleActivities } from '../schedules/activities';

// Workflow code must stay deterministic: no I/O, clock, randomness or flag reads here. The kill
// switch and the version lookup live in the activity (F7, research R6, R13).

/** What the action of the Temporal Schedule passes to every firing. */
export const FireScheduleInputSchema = z.strictObject({
  organizationId: z.uuid(),
  workflowId: z.uuid(),
});
export type FireScheduleInput = z.infer<typeof FireScheduleInputSchema>;

export type FireScheduleResult =
  { status: 'skipped'; reason: string } | { status: 'finished'; runId: string };

const { startScheduledRun } = proxyActivities<ScheduleActivities>({
  startToCloseTimeout: '30 seconds',
  retry: { initialInterval: '1 second', backoffCoefficient: 2, maximumAttempts: 5 },
});

const { recordRunEvent } = proxyActivities<RunEventActivities>({
  startToCloseTimeout: '15 seconds',
  retry: { initialInterval: '1 second', backoffCoefficient: 2, maximumAttempts: 10 },
});

/**
 * The launcher between a Temporal Schedule and `executeDag` (F7, research R6). A Schedule can only
 * start a workflow with fixed arguments, but the version to run is decided at the moment of the
 * firing (5A). So the Schedule starts this short workflow, which creates the run with the active
 * version and starts `executeDag` as a child that outlives it (`ABANDON`), then waits for it to
 * end. While it waits the launcher stays open, which is what lets the `SKIP` overlap policy of the
 * Schedule skip the next firings while a run is going (or waiting for an approval).
 */
export async function fireSchedule(rawInput: unknown): Promise<FireScheduleResult> {
  const parsed = FireScheduleInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw ApplicationFailure.create({
      type: 'INVALID_INPUT',
      message: 'The workflow input does not match the contract.',
      nonRetryable: true,
    });
  }
  const { organizationId, workflowId } = parsed.data;
  const info = workflowInfo();
  // The Schedule stamps the programmed time of the firing as a search attribute; a start outside a
  // Schedule (a test, a manual trigger) falls back to the start time of this workflow.
  const stamped = info.searchAttributes?.['TemporalScheduledStartTime'];
  const scheduledAt = (
    Array.isArray(stamped) && stamped[0] instanceof Date ? stamped[0] : info.startTime
  ).toISOString();
  const correlationId = uuid4();

  const started = await startScheduledRun({
    organizationId,
    workflowId,
    scheduledAt,
    correlationId,
  });
  if (started.status === 'skipped') return { status: 'skipped', reason: started.reason };

  let child;
  try {
    child = await startChild(EXECUTE_DAG_WORKFLOW_NAME, {
      workflowId: started.temporalWorkflowId,
      args: [started.input],
      parentClosePolicy: ParentClosePolicy.ABANDON,
      workflowExecutionTimeout: `${started.executionTimeoutSeconds} seconds`,
    });
  } catch {
    // The run exists as `queued` and nothing will ever move it: end it, so the limit is not held.
    await recordRunEvent({
      organizationId,
      runId: started.runId,
      correlationId,
      at: new Date().toISOString(),
      transition: 'run.finished',
      status: 'failed',
      errorCode: 'WORKFLOW_START_FAILED',
      errorMessage: 'The run could not be started.',
    });
    throw ApplicationFailure.create({
      type: 'WORKFLOW_START_FAILED',
      message: 'The run could not be started.',
      nonRetryable: true,
    });
  }
  try {
    await child.result();
  } catch {
    // A failed run is already recorded by the run itself; the launcher only has to end.
  }
  return { status: 'finished', runId: started.runId };
}
