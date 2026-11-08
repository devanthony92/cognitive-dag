import { Inject, Injectable } from '@nestjs/common';
import {
  SearchAttributeType,
  TypedSearchAttributes,
  defineSearchAttributeKey,
  type Duration,
} from '@temporalio/common';
import { WorkflowIdReusePolicy } from '@temporalio/client';
import { and, eq, workflowRuns, type DatabaseClient, type TenantContext } from '@cognitive-dag/db';
import {
  CORRELATION_ID_SEARCH_ATTRIBUTE,
  DEFAULT_RUN_MAX_DURATION_MS,
  EXECUTE_DAG_WORKFLOW_NAME,
  FEATURE_FLAGS,
  RUN_EXECUTION_TIMEOUT,
  type ExecuteDagInput,
} from '@cognitive-dag/contracts';
import { approvalWaitBudgetMs, type DagDefinition } from '@cognitive-dag/dag-schema';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env.schema';
import { DATABASE } from '../database/database.module';
import { FlagsService } from '../flags/flags.service';
import { RunTemporalService } from './run-history.service';

export type ExecutablePhases = NonNullable<ExecuteDagInput['executablePhases']>;

const CORRELATION_ID_KEY = defineSearchAttributeKey(
  CORRELATION_ID_SEARCH_ATTRIBUTE,
  SearchAttributeType.KEYWORD,
);

/** Margin of the hard timeout of Temporal over the duration the interpreter enforces itself. */
const EXECUTION_TIMEOUT_MARGIN_MS = 60_000;

export interface LaunchableRun {
  id: string;
  temporalWorkflowId: string;
  correlationId: string;
}

/**
 * What every way of starting a run shares after the row exists (F7, T059): which phases may run,
 * how long the run may take (the approval deadlines are time spent waiting for people, so they
 * widen both the run bound and the hard timeout of Temporal), and the call that starts the workflow.
 */
@Injectable()
export class RunLauncher {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly temporal: RunTemporalService,
    private readonly flags: FlagsService,
  ) {}

  /** F3 always; F5 with `llm-nodes-enabled`; F7 with `triggers-enabled` (the workflow cannot read flags). */
  async executablePhases(): Promise<ExecutablePhases> {
    const phases: ExecutablePhases = ['F3'];
    if (await this.flags.isEnabled(FEATURE_FLAGS.llmNodesEnabled)) phases.push('F5');
    if (await this.flags.isEnabled(FEATURE_FLAGS.triggersEnabled)) phases.push('F7');
    return phases;
  }

  /** The run bound: the base duration plus the time the approval nodes may wait. */
  maxDurationMs(definition: Pick<DagDefinition, 'nodes'>): number {
    return DEFAULT_RUN_MAX_DURATION_MS + approvalWaitBudgetMs(definition);
  }

  /**
   * Fields of the workflow input that depend on the phases and the definition. Each is sent only
   * when it differs from the default, so a run without F5 or F7 keeps the input it had before.
   */
  inputExtras(
    phases: ExecutablePhases,
    definition: Pick<DagDefinition, 'nodes'>,
  ): Pick<
    ExecuteDagInput,
    'executablePhases' | 'llmTaskQueue' | 'httpTaskQueue' | 'maxDurationMs'
  > {
    const maxDurationMs = this.maxDurationMs(definition);
    return {
      ...(phases.length > 1 ? { executablePhases: phases } : {}),
      llmTaskQueue: this.config.TEMPORAL_LLM_TASK_QUEUE,
      ...(phases.includes('F7') ? { httpTaskQueue: this.config.TEMPORAL_HTTP_TASK_QUEUE } : {}),
      ...(maxDurationMs > DEFAULT_RUN_MAX_DURATION_MS ? { maxDurationMs } : {}),
    };
  }

  private executionTimeout(input: ExecuteDagInput): Duration {
    if (input.maxDurationMs === undefined) return RUN_EXECUTION_TIMEOUT;
    return input.maxDurationMs + EXECUTION_TIMEOUT_MARGIN_MS;
  }

  /**
   * Asks Temporal to start; on failure the run ends `failed` and the caller gets 503. A webhook
   * passes `rejectDuplicate` so Temporal itself refuses a second start for the same event.
   */
  async launch(
    context: TenantContext,
    run: LaunchableRun,
    input: ExecuteDagInput,
    options: { rejectDuplicate?: boolean } = {},
  ): Promise<void> {
    try {
      await this.temporal.withDeadline(() =>
        this.temporal.client.workflow.start(EXECUTE_DAG_WORKFLOW_NAME, {
          taskQueue: this.config.TEMPORAL_TASK_QUEUE,
          workflowId: run.temporalWorkflowId,
          args: [input],
          workflowExecutionTimeout: this.executionTimeout(input),
          ...(options.rejectDuplicate
            ? { workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE }
            : {}),
          typedSearchAttributes: new TypedSearchAttributes([
            { key: CORRELATION_ID_KEY, value: run.correlationId },
          ]),
        }),
      );
    } catch (error) {
      await this.database.withContext(context, (tx) =>
        tx
          .update(workflowRuns)
          .set({
            status: 'failed',
            errorCode: 'SERVICE_UNAVAILABLE',
            errorMessage: 'No se pudo iniciar la ejecución en el motor.',
            finishedAt: new Date(),
          })
          .where(and(eq(workflowRuns.id, run.id), eq(workflowRuns.status, 'queued'))),
      );
      // The request may have reached Temporal before the deadline: do not leave a run nobody records.
      await this.temporal
        .withDeadline(() =>
          this.temporal.client.workflow.getHandle(run.temporalWorkflowId).terminate('start failed'),
        )
        .catch(() => undefined);
      throw this.temporal.translate(error);
    }
  }
}
