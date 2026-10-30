import { createHash, randomUUID } from 'node:crypto';
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
import {
  DomainException,
  ResourceNotFoundException,
  ServiceUnavailableException,
} from '../common/errors/domain.exception';
import { hasCompletedWorkflowTask } from './ping-status';
import { TEMPORAL_CLIENT } from '../temporal/temporal.module';

/** Memo key that records which organization a ping belongs to (F1, FR-017). */
const ORGANIZATION_MEMO_KEY = 'organizationId';

const CORRELATION_ID_KEY = defineSearchAttributeKey(
  CORRELATION_ID_SEARCH_ATTRIBUTE,
  SearchAttributeType.KEYWORD,
);

// gRPC status codes that mean "Temporal is not reachable" rather than "the request is wrong".
const GRPC_UNAVAILABLE = 14;
const GRPC_DEADLINE_EXCEEDED = 4;

// A lazy connection to an unreachable Temporal would otherwise block the request indefinitely.
const TEMPORAL_CALL_DEADLINE_MS = 5_000;

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
    /** Set under /organizations/{id}/pings: the ping is stored with its owner. */
    organizationId?: string;
  }): Promise<PingExecution> {
    const workflowId = pingWorkflowId(input.idempotencyKey, input.organizationId);
    const args: PingWorkflowInput = {
      correlationId: input.correlationId,
      ...(input.message === undefined ? {} : { message: input.message }),
    };

    try {
      await this.withDeadline(() =>
        this.client.workflow.start(PING_WORKFLOW_NAME, {
          taskQueue: this.config.TEMPORAL_TASK_QUEUE,
          workflowId,
          args: [args],
          workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
          workflowExecutionTimeout: PING_EXECUTION_TIMEOUT,
          typedSearchAttributes: new TypedSearchAttributes([
            { key: CORRELATION_ID_KEY, value: input.correlationId },
          ]),
          ...(input.organizationId === undefined
            ? {}
            : { memo: { [ORGANIZATION_MEMO_KEY]: input.organizationId } }),
        }),
      );
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw this.translate(error);
    }
    return this.get(workflowId, input.organizationId);
  }

  /**
   * With `organizationId` the ping must belong to that organization; a ping of another one, or a
   * F0 ping that has no owner, is indistinguishable from a missing one (FR-018). Without it only
   * ownerless F0 pings are visible.
   */
  async get(pingId: string, organizationId?: string): Promise<PingExecution> {
    const handle = this.client.workflow.getHandle(pingId);
    let description: WorkflowExecutionDescription;
    try {
      description = await this.withDeadline(() => handle.describe());
    } catch (error) {
      throw this.translate(error, organizationId);
    }
    if (description.type !== PING_WORKFLOW_NAME) throw pingNotFound(organizationId);
    if (description.memo?.[ORGANIZATION_MEMO_KEY] !== organizationId) {
      throw pingNotFound(organizationId);
    }

    let status: PingStatus;
    try {
      status = await this.withDeadline(() => this.toPingStatus(handle, description));
    } catch (error) {
      throw this.translate(error, organizationId);
    }
    const correlationId = description.typedSearchAttributes.get(CORRELATION_ID_KEY);
    if (correlationId === undefined) throw pingNotFound(organizationId);

    let result: unknown;
    if (status === 'completed') {
      try {
        result = await this.withDeadline(() => handle.result());
      } catch (error) {
        throw this.translate(error, organizationId);
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

  private withDeadline<T>(call: () => Promise<T>): Promise<T> {
    return this.client.connection.withDeadline(Date.now() + TEMPORAL_CALL_DEADLINE_MS, call);
  }

  private translate(error: unknown, organizationId?: string): Error {
    if (error instanceof WorkflowNotFoundError) return pingNotFound(organizationId);
    if (isTemporalUnavailable(error)) return new ServiceUnavailableException();
    return error instanceof Error ? error : new Error('Unknown Temporal error');
  }
}

/**
 * `ping-<uuid>`. The F0 route uses the key itself. Under an organization the id is a UUID derived
 * from SHA-256 of `<organizationId>:<key>`, so the same key in two organizations is two pings and
 * a repeated key can never reveal that another organization used it (FR-017).
 */
export function pingWorkflowId(idempotencyKey?: string, organizationId?: string): string {
  if (idempotencyKey === undefined) return `ping-${randomUUID()}`;
  const key = idempotencyKey.toLowerCase();
  if (organizationId === undefined) return `ping-${key}`;
  const bytes = createHash('sha256').update(`${organizationId}:${key}`, 'utf8').digest();
  // Version 5 / RFC 4122 variant bits keep it a well-formed UUID.
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `ping-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function pingNotFound(organizationId?: string): DomainException {
  // Under an organization every miss has the one generic answer of the tenancy layer.
  if (organizationId !== undefined) return new ResourceNotFoundException();
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
