import {
  DEFAULT_RUN_MAX_DURATION_MS,
  temporalWorkflowIdFor,
  DEFAULT_MAX_CONCURRENT_RUNS,
  type ExecuteDagInput,
} from '@cognitive-dag/contracts';
import { DagDefinitionSchema, approvalWaitBudgetMs } from '@cognitive-dag/dag-schema';
import { startRun, type WithContext } from '@cognitive-dag/db';
import type { Logger } from '@cognitive-dag/logger';

export interface StartScheduledRunInput {
  organizationId: string;
  workflowId: string;
  /** The programmed time of the firing (ISO 8601). */
  scheduledAt: string;
  correlationId: string;
}

/** Why a firing did not start a run; each one is logged as `schedule.skipped`. */
export type ScheduleSkipReason =
  | 'triggers_disabled'
  | 'workflow_not_found'
  | 'workflow_archived'
  | 'no_active_version'
  | 'trigger_missing'
  | 'run_limit_reached'
  | 'invalid_definition';

export type StartScheduledRunResult =
  | { status: 'skipped'; reason: ScheduleSkipReason }
  | {
      status: 'started';
      /** Id of the Temporal workflow of the run: `run-<runId>`. */
      temporalWorkflowId: string;
      runId: string;
      /** Hard timeout of the workflow, in seconds: the maximum duration plus a margin. */
      executionTimeoutSeconds: number;
      input: ExecuteDagInput;
    };

export interface ScheduleActivities {
  startScheduledRun(input: StartScheduledRunInput): Promise<StartScheduledRunResult>;
}

export interface ScheduleActivityOptions {
  withContext: WithContext;
  logger: Logger;
  /** `TRIGGERS_ENABLED`: false skips every firing (the schedules stay in place, research R13). */
  triggersOn: boolean;
  /** `LLM_ENABLED`: the worker cannot read the API flag, so F5 nodes run only if the LLM is on. */
  llmEnabled: boolean;
  /** `TEMPORAL_LLM_TASK_QUEUE` and `TEMPORAL_HTTP_TASK_QUEUE`, carried in the input of the run. */
  llmTaskQueue: string;
  httpTaskQueue: string;
}

/** Margin of the hard timeout of Temporal over the maximum duration the interpreter enforces. */
const EXECUTION_TIMEOUT_MARGIN_MS = 60_000;

/**
 * The first step of a firing (F7, research R6): with the active version of the moment (decision
 * 5A), the concurrency limit and the insert shared with the API, it creates the run. The launcher
 * workflow then starts `executeDag` as a child. A firing that cannot start a run is skipped and
 * logged, never retried: the next firing of the schedule is the retry.
 */
export function createScheduleActivities(options: ScheduleActivityOptions): ScheduleActivities {
  return {
    async startScheduledRun(input) {
      const log = options.logger.child({
        correlationId: input.correlationId,
        workflowId: input.workflowId,
        event: 'schedule',
      });
      const skip = (reason: ScheduleSkipReason): StartScheduledRunResult => {
        log.warn({ event: 'schedule.skipped', reason }, 'Scheduled firing skipped');
        return { status: 'skipped', reason };
      };
      if (!options.triggersOn) return skip('triggers_disabled');

      /** Thrown inside the transaction so the run inserted for a version that cannot run is undone. */
      class Skip extends Error {
        constructor(readonly reason: ScheduleSkipReason) {
          super(reason);
        }
      }
      let outcome;
      try {
        outcome = await options.withContext(
          { organizationId: input.organizationId },
          async (tx) => {
            const result = await startRun(tx, {
              organizationId: input.organizationId,
              workflowId: input.workflowId,
              correlationId: input.correlationId,
              trigger: { kind: 'schedule', scheduledAt: new Date(input.scheduledAt) },
              defaultMaxConcurrentRuns: DEFAULT_MAX_CONCURRENT_RUNS,
              temporalWorkflowId: temporalWorkflowIdFor,
            });
            if (!result.ok) {
              throw new Skip(
                result.reason === 'duplicate_event' ? 'run_limit_reached' : result.reason,
              );
            }
            const parsed = DagDefinitionSchema.safeParse(result.version.definition);
            if (!parsed.success) throw new Skip('invalid_definition');
            // A version without the schedule trigger must not run.
            if (!parsed.data.nodes.some((node) => node.type === 'trigger.schedule')) {
              throw new Skip('trigger_missing');
            }
            return { ...result, definition: parsed.data };
          },
        );
      } catch (error) {
        if (error instanceof Skip) return skip(error.reason);
        throw error;
      }

      const maxDurationMs = DEFAULT_RUN_MAX_DURATION_MS + approvalWaitBudgetMs(outcome.definition);
      const executionTimeoutSeconds = Math.ceil(
        (maxDurationMs + EXECUTION_TIMEOUT_MARGIN_MS) / 1000,
      );
      const { run, version } = outcome;
      log.info({ event: 'schedule.fired', runId: run.id }, 'Scheduled run created');
      return {
        status: 'started',
        temporalWorkflowId: run.temporalWorkflowId,
        runId: run.id,
        executionTimeoutSeconds,
        input: {
          organizationId: input.organizationId,
          workflowId: input.workflowId,
          versionId: version.id,
          versionNumber: version.versionNumber,
          runId: run.id,
          correlationId: input.correlationId,
          definition: version.definition,
          triggerInput: {},
          maxDurationMs,
          executablePhases: ['F3', ...(options.llmEnabled ? (['F5'] as const) : []), 'F7'],
          llmTaskQueue: options.llmTaskQueue,
          httpTaskQueue: options.httpTaskQueue,
          triggerKind: 'schedule',
          scheduledAt: new Date(input.scheduledAt).toISOString(),
        },
      };
    },
  };
}
