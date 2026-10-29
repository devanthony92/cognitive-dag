import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  Client,
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdReusePolicy,
  type WorkflowHandle,
  type WorkflowExecutionDescription,
} from '@temporalio/client';
import {
  SearchAttributeType,
  TypedSearchAttributes,
  WorkflowNotFoundError,
  defineSearchAttributeKey,
} from '@temporalio/common';
import {
  CORRELATION_ID_SEARCH_ATTRIBUTE,
  PING_EXECUTION_TIMEOUT,
  PING_WORKFLOW_NAME,
  PingResultSchema,
  type PingExecution,
  type PingStatus,
  type PingWorkflowInput,
} from '@cognitive-dag/contracts';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env.schema';
import { DomainException, ServiceUnavailableException } from '../common/errors/domain.exception';
import { hasCompletedWorkflowTask } from './ping-status';
import { TEMPORAL_CLIENT } from '../temporal/temporal.module';

const CORRELATION_ID_KEY = defineSearchAttributeKey(
  CORRELATION_ID_SEARCH_ATTRIBUTE,
  SearchAttributeType.KEYWORD,
);

// gRPC status codes that mean "Temporal is not reachable" rather than "the request is wrong".
const GRPC_UNAVAILABLE = 14;
const GRPC_DEADLINE_EXCEEDED = 4;

@Injectable()
export class PingService {
  constructor(
    @Inject(TEMPORAL_CLIENT) private readonly client: Client,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Starts a ping. The workflow id is derived from the idempotency key and Temporal rejects
   * duplicates, so a repeated key returns the existing execution (research.md R7).
   */
  async create(input: {
    correlationId: string;
    message?: string;
    idempotencyKey?: string;
  }): Promise<PingExecution> {
    const workflowId = `ping-${(input.idempotencyKey ?? randomUUID()).toLowerCase()}`;
    const args: PingWorkflowInput = {
      correlationId: input.correlationId,
      ...(input.message === undefined ? {} : { message: input.message }),
    };

    try {
      await this.client.workflow.start(PING_WORKFLOW_NAME, {
        taskQueue: this.config.TEMPORAL_TASK_QUEUE,
        workflowId,
        args: [args],
        workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
        workflowExecutionTimeout: PING_EXECUTION_TIMEOUT,
        typedSearchAttributes: new TypedSearchAttributes([
          { key: CORRELATION_ID_KEY, value: input.correlationId },
        ]),
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw this.translate(error);
    }
    return this.get(workflowId);
  }

  async get(pingId: string): Promise<PingExecution> {
    const handle = this.client.workflow.getHandle(pingId);
    let description: WorkflowExecutionDescription;
    try {
      description = await handle.describe();
    } catch (error) {
      throw this.translate(error);
    }
    if (description.type !== PING_WORKFLOW_NAME) throw pingNotFound();

    let status: PingStatus;
    try {
      status = await this.toPingStatus(handle, description);
    } catch (error) {
      throw this.translate(error);
    }
    const correlationId = description.typedSearchAttributes.get(CORRELATION_ID_KEY);
    if (correlationId === undefined) throw pingNotFound();

    let result: unknown;
    if (status === 'completed') {
      try {
        result = await handle.result();
      } catch (error) {
        throw this.translate(error);
      }
    }

    return {
      pingId,
      correlationId,
      status,
      ...(result === undefined ? {} : { result: PingResultSchema.parse(result) }),
      startedAt: description.startTime.toISOString(),
      ...(description.closeTime ? { finishedAt: description.closeTime.toISOString() } : {}),
    };
  }

  /**
   * The overall status comes from describe() (queries need a live worker). A RUNNING execution
   * is pending until some workflow task has completed; that needs the (tiny) history.
   */
  private async toPingStatus(
    handle: WorkflowHandle,
    description: WorkflowExecutionDescription,
  ): Promise<PingStatus> {
    switch (description.status.name) {
      case 'RUNNING': {
        const { events } = await handle.fetchHistory();
        return hasCompletedWorkflowTask(events ?? []) ? 'running' : 'pending';
      }
      case 'COMPLETED':
        return 'completed';
      case 'TIMED_OUT':
        return 'timed_out';
      default:
        return 'failed';
    }
  }

  private translate(error: unknown): Error {
    if (error instanceof WorkflowNotFoundError) return pingNotFound();
    if (isTemporalUnavailable(error)) return new ServiceUnavailableException();
    return error instanceof Error ? error : new Error('Unknown Temporal error');
  }
}

function pingNotFound(): DomainException {
  return new DomainException(
    404,
    'PING_NOT_FOUND',
    'No existe una ejecución de ping con ese identificador.',
  );
}

function isTemporalUnavailable(error: unknown): boolean {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    const code = (current as { code?: unknown }).code;
    if (code === GRPC_UNAVAILABLE || code === GRPC_DEADLINE_EXCEEDED) return true;
  }
  return false;
}
