import {
  ScheduleNotFoundError,
  ScheduleOverlapPolicy,
  type Client,
  type ScheduleOptions,
} from '@temporalio/client';
import { FIRE_SCHEDULE_WORKFLOW_NAME, scheduleIdFor } from '@cognitive-dag/contracts';
import { and, eq, sql, workflowSchedules, type WithContext } from '@cognitive-dag/db';
import type { Logger } from '@cognitive-dag/logger';
import type { WorkerSecurityEvent } from '../logging/security-events';

export interface ScheduleReconcilerOptions {
  withContext: WithContext;
  /** Only the schedule API of the client is used. */
  client: Pick<Client, 'schedule'>;
  /** Task queue the launcher `fireSchedule` runs on: the main one. */
  taskQueue: string;
  /** `SCHEDULE_CATCHUP_WINDOW_SECONDS`: how late a missed firing may still run. */
  catchupWindowSeconds: number;
  /** `TRIGGERS_ENABLED`: false pauses the reconciliation along with the firings (research R13). */
  triggersOn: boolean;
  logger: Logger;
  /** Rows handled per pass; the rest wait for the next one. */
  batchSize?: number;
}

export interface ReconcileResult {
  synced: number;
  failed: number;
}

export interface ScheduleReconciler {
  /** One pass over the schedules that are not synced. Idempotent: running it twice changes nothing. */
  reconcileOnce(): Promise<ReconcileResult>;
  /** The timer of the worker (every 60 s); stops when `signal` aborts. */
  run(signal: AbortSignal, everyMs?: number): Promise<void>;
}

/** Interval of the timer of the worker (research R6). */
export const RECONCILE_EVERY_MS = 60_000;
/**
 * Consecutive failed syncs after which a row is left alone (ADR-0085). It stays `failed` with its
 * code; a new active version or a new configuration starts the count again (the API writes
 * `sync_attempts = 0`, `pending`).
 */
export const MAX_SYNC_ATTEMPTS = 20;
const DEFAULT_BATCH_SIZE = 50;
const SYNC_FAILED_CODE = 'SCHEDULE_SYNC_FAILED';

interface PendingRow {
  id: string;
  organizationId: string;
  workflowId: string;
  cron: string;
  timezone: string;
  desiredState: string;
  updatedAt: Date;
}

/** The Temporal Schedule a row asks for (research R6): `SKIP` on overlap, bounded catch-up. */
export function buildScheduleOptions(
  row: Pick<PendingRow, 'organizationId' | 'workflowId' | 'cron' | 'timezone'>,
  options: Pick<ScheduleReconcilerOptions, 'taskQueue' | 'catchupWindowSeconds'>,
): ScheduleOptions {
  return {
    scheduleId: scheduleIdFor(row.workflowId),
    spec: { cronExpressions: [row.cron], timezone: row.timezone },
    policies: {
      overlap: ScheduleOverlapPolicy.SKIP,
      catchupWindow: `${options.catchupWindowSeconds} seconds`,
    },
    action: {
      type: 'startWorkflow',
      workflowType: FIRE_SCHEDULE_WORKFLOW_NAME,
      taskQueue: options.taskQueue,
      // Temporal appends the programmed time of each firing to this id.
      workflowId: scheduleIdFor(row.workflowId),
      args: [{ organizationId: row.organizationId, workflowId: row.workflowId }],
    },
  };
}

/**
 * The row is the one that was read. Postgres keeps microseconds and a `Date` only milliseconds, so
 * the comparison truncates the column to milliseconds.
 */
const unchanged = (row: Pick<PendingRow, 'updatedAt'>) =>
  sql`date_trunc('milliseconds', ${workflowSchedules.updatedAt}) = ${row.updatedAt.toISOString()}::timestamptz`;

export function createScheduleReconciler(options: ScheduleReconcilerOptions): ScheduleReconciler {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const { schedule } = options.client;

  /** Creates the schedule, or updates it when it already exists (idempotent). */
  async function upsert(row: PendingRow): Promise<void> {
    const wanted = buildScheduleOptions(row, options);
    const handle = schedule.getHandle(wanted.scheduleId);
    try {
      await handle.update((previous) => ({
        spec: wanted.spec,
        policies: wanted.policies ?? {},
        action: wanted.action,
        state: previous.state,
      }));
    } catch (error) {
      if (!(error instanceof ScheduleNotFoundError)) throw error;
      await schedule.create(wanted);
    }
  }

  /** Deletes the schedule; one that does not exist is already as wanted. */
  async function remove(row: PendingRow): Promise<void> {
    try {
      await schedule.getHandle(scheduleIdFor(row.workflowId)).delete();
    } catch (error) {
      if (!(error instanceof ScheduleNotFoundError)) throw error;
    }
  }

  async function markSynced(row: PendingRow): Promise<void> {
    // Only if nobody changed the wanted state while Temporal was being updated: otherwise the row
    // stays pending and the next pass applies the newer state.
    await options.withContext({ organizationId: row.organizationId }, (tx) =>
      tx
        .update(workflowSchedules)
        .set({
          syncStatus: 'synced',
          syncedAt: sql`now()`,
          lastErrorCode: null,
          syncAttempts: 0,
        })
        .where(and(eq(workflowSchedules.id, row.id), unchanged(row))),
    );
  }

  /** Records the failure; returns the attempts so far, or undefined if the row changed meanwhile. */
  async function markFailed(row: PendingRow): Promise<number | undefined> {
    const [updated] = await options.withContext({ organizationId: row.organizationId }, (tx) =>
      tx
        .update(workflowSchedules)
        .set({
          syncStatus: 'failed',
          lastErrorCode: SYNC_FAILED_CODE,
          syncAttempts: sql`least(${workflowSchedules.syncAttempts} + 1, 32767)`,
        })
        .where(and(eq(workflowSchedules.id, row.id), unchanged(row)))
        .returning({ attempts: workflowSchedules.syncAttempts }),
    );
    return updated?.attempts;
  }

  return {
    async reconcileOnce() {
      const result: ReconcileResult = { synced: 0, failed: 0 };
      if (!options.triggersOn) return result;
      // The reconciler does not know the organizations: the lookup key lets it read, and only read,
      // the rows not yet synced. Every write enters the context of the organization of the row.
      const rows = await options.withContext({ reconciler: 'schedules' }, (tx) =>
        tx
          .select({
            id: workflowSchedules.id,
            organizationId: workflowSchedules.organizationId,
            workflowId: workflowSchedules.workflowId,
            cron: workflowSchedules.cron,
            timezone: workflowSchedules.timezone,
            desiredState: workflowSchedules.desiredState,
            updatedAt: workflowSchedules.updatedAt,
          })
          .from(workflowSchedules)
          .where(
            sql`${workflowSchedules.syncStatus} <> 'synced'
              AND ${workflowSchedules.syncAttempts} < ${MAX_SYNC_ATTEMPTS}`,
          )
          .orderBy(workflowSchedules.updatedAt)
          .limit(batchSize),
      );
      for (const row of rows) {
        const log = options.logger.child({ workflowId: row.workflowId });
        try {
          if (row.desiredState === 'scheduled') await upsert(row);
          else await remove(row);
          await markSynced(row);
          result.synced += 1;
          log.info({ event: 'schedule.synced', desiredState: row.desiredState }, 'Schedule synced');
        } catch (error) {
          result.failed += 1;
          log.warn({ event: 'schedule.failed', err: error }, 'Could not sync the schedule');
          try {
            const attempts = await markFailed(row);
            // The attempt that reaches the cap is the last one: say so once.
            if (attempts === MAX_SYNC_ATTEMPTS) {
              const name: WorkerSecurityEvent = 'schedule.sync_failed';
              log.warn(
                {
                  event: name,
                  organizationId: row.organizationId,
                  attempts,
                  errorCode: SYNC_FAILED_CODE,
                },
                'The schedule could not be synced; no more attempts',
              );
            }
          } catch (markError) {
            log.warn({ err: markError }, 'Could not record the failed sync');
          }
        }
      }
      return result;
    },

    async run(signal, everyMs = RECONCILE_EVERY_MS) {
      while (!signal.aborted) {
        try {
          await this.reconcileOnce();
        } catch (error) {
          // A pass that fails as a whole (database down) is tried again at the next tick.
          options.logger.warn({ err: error }, 'Schedule reconciliation pass failed');
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, everyMs);
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      }
    },
  };
}
