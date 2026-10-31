import { Inject, Injectable } from '@nestjs/common';
import type { Client } from '@temporalio/client';
import { WorkflowNotFoundError } from '@temporalio/common';
import { ServiceUnavailableException } from '../common/errors/domain.exception';
import { TEMPORAL_CLIENT } from '../temporal/temporal.module';

// gRPC status codes that mean "Temporal is not reachable" rather than "the request is wrong".
const GRPC_UNAVAILABLE = 14;
const GRPC_DEADLINE_EXCEEDED = 4;

// A lazy connection to an unreachable Temporal would otherwise block the request indefinitely.
export const TEMPORAL_CALL_DEADLINE_MS = 5_000;

const GRPC_NOT_FOUND = 5;

function isNotFound(error: unknown): boolean {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if ((current as { code?: unknown }).code === GRPC_NOT_FOUND) return true;
  }
  return false;
}

export function isTemporalUnavailable(error: unknown): boolean {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    const code = (current as { code?: unknown }).code;
    if (code === GRPC_UNAVAILABLE || code === GRPC_DEADLINE_EXCEEDED) return true;
  }
  return false;
}

type HistoryEvents = NonNullable<
  Awaited<ReturnType<ReturnType<Client['workflow']['getHandle']>['fetchHistory']>>['events']
>;

/** Temporal calls with a deadline, and the translation of their failures (research R6, decision 5C). */
@Injectable()
export class RunTemporalService {
  constructor(@Inject(TEMPORAL_CLIENT) readonly client: Client) {}

  withDeadline<T>(call: () => Promise<T>): Promise<T> {
    return this.client.connection.withDeadline(Date.now() + TEMPORAL_CALL_DEADLINE_MS, call);
  }

  /** Any failure of Temporal that is not "unknown workflow" is the service being unavailable. */
  translate(error: unknown): Error {
    if (isTemporalUnavailable(error)) return new ServiceUnavailableException();
    return error instanceof Error ? error : new Error('Unknown Temporal error');
  }

  /**
   * The history of a run, or `undefined` when Temporal no longer has it (retention). The content
   * of a run lives only there (decision 5C).
   */
  async history(temporalWorkflowId: string): Promise<HistoryEvents | undefined> {
    try {
      const history = await this.withDeadline(() =>
        this.client.workflow.getHandle(temporalWorkflowId).fetchHistory(),
      );
      return history.events ?? [];
    } catch (error) {
      if (error instanceof WorkflowNotFoundError || isNotFound(error)) return undefined;
      throw this.translate(error);
    }
  }
}
