import { Inject, Injectable } from '@nestjs/common';
import { ScheduleNotFoundError, type Client } from '@temporalio/client';
import {
  and,
  eq,
  organizationLimits,
  sql,
  workflowSchedules,
  workflowVersions,
  type DatabaseClient,
  type Tx,
} from '@cognitive-dag/db';
import { SCHEDULE_NEXT_RUNS_MAX, scheduleIdFor, type Schedule } from '@cognitive-dag/contracts';
import { DagDefinitionSchema } from '@cognitive-dag/dag-schema';
import { DomainException, ResourceNotFoundException } from '../common/errors/domain.exception';
import { DATABASE } from '../database/database.module';
import { SecurityEventLogger } from '../security-events/security-event.logger';
import { RunTemporalService } from '../runs/run-history.service';
import { findActiveWorkflow } from '../workflows/workflow-queries';

/** Active schedules an organization may have when the operator set no limit of its own. */
export const DEFAULT_MAX_ACTIVE_SCHEDULES = 10;

export interface ScheduleActor {
  userId: string;
  organizationId: string;
  ip: string;
}

/** The part of a version the schedule needs. */
export interface ScheduledVersion {
  id: string;
  definition: unknown;
}

/**
 * The wanted state of the Temporal Schedule of each workflow (F7, research R6). Activating a version
 * only writes the row `workflow_schedules`, in the same transaction as the activation, so the two
 * never disagree; the reconciler of the worker applies it to Temporal and retries until it works. A
 * Temporal outage therefore never blocks an activation.
 */
@Injectable()
export class SchedulesService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseClient,
    private readonly temporal: RunTemporalService,
    private readonly events: SecurityEventLogger,
  ) {}

  /**
   * Called inside the transaction that makes `version` the active one. A version with a schedule
   * trigger asks for the schedule; one without it removes whatever schedule the workflow had.
   */
  async syncActiveVersion(
    tx: Tx,
    organizationId: string,
    workflowId: string,
    version: ScheduledVersion,
  ): Promise<void> {
    const parsed = DagDefinitionSchema.safeParse(version.definition);
    const node = parsed.success
      ? parsed.data.nodes.find((candidate) => candidate.type === 'trigger.schedule')
      : undefined;
    if (!node) {
      await this.markRemoved(tx, workflowId);
      return;
    }
    const { cron, timezone } = node.config as { cron: string; timezone?: string };
    const zone = timezone ?? 'UTC';

    const [current] = await tx
      .select()
      .from(workflowSchedules)
      .where(eq(workflowSchedules.workflowId, workflowId));
    if (current?.desiredState === 'scheduled') {
      const sameSpec = current.cron === cron && current.timezone === zone;
      if (sameSpec) {
        // Another version with the same schedule: Temporal already has it, only the row follows.
        if (current.versionId !== version.id) {
          await tx
            .update(workflowSchedules)
            .set({
              versionId: version.id,
              // A new active version starts the reconciler's attempts over (ADR-0085): a row it
              // gave up on is tried again. A synced row stays synced.
              ...(current.syncStatus === 'synced'
                ? {}
                : { syncStatus: 'pending', syncAttempts: 0, lastErrorCode: null }),
            })
            .where(eq(workflowSchedules.id, current.id));
        }
        return;
      }
    } else {
      await this.assertRoom(tx, organizationId);
    }

    await tx
      .insert(workflowSchedules)
      .values({ organizationId, workflowId, versionId: version.id, cron, timezone: zone })
      .onConflictDoUpdate({
        target: workflowSchedules.workflowId,
        set: {
          versionId: version.id,
          cron,
          timezone: zone,
          desiredState: 'scheduled',
          syncStatus: 'pending',
          syncAttempts: 0,
          lastErrorCode: null,
          syncedAt: null,
        },
      });
  }

  /** The workflow no longer has a schedule (archived, or its active version has none). */
  async remove(tx: Tx, workflowId: string): Promise<void> {
    await this.markRemoved(tx, workflowId);
  }

  private async markRemoved(tx: Tx, workflowId: string): Promise<void> {
    await tx
      .update(workflowSchedules)
      .set({ desiredState: 'removed', syncStatus: 'pending', syncAttempts: 0, lastErrorCode: null })
      .where(
        and(
          eq(workflowSchedules.workflowId, workflowId),
          eq(workflowSchedules.desiredState, 'scheduled'),
        ),
      );
  }

  /** Counts under a lock of the organization, so two activations at once cannot both take the last place. */
  private async assertRoom(tx: Tx, organizationId: string): Promise<void> {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${organizationId}:schedules`}, 0))`,
    );
    const [limits] = await tx
      .select({ max: organizationLimits.maxActiveSchedules })
      .from(organizationLimits)
      .where(eq(organizationLimits.organizationId, organizationId));
    const max = limits?.max ?? DEFAULT_MAX_ACTIVE_SCHEDULES;
    const [row] = (
      await tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM workflow_schedules
            WHERE organization_id = ${organizationId} AND desired_state = 'scheduled'`,
      )
    ).rows;
    if ((row?.n ?? 0) >= max) {
      throw new DomainException(
        409,
        'SCHEDULE_LIMIT_REACHED',
        `La organización ya tiene ${max} programaciones activas, que es el máximo. Desactiva alguna antes de activar otra.`,
      );
    }
  }

  /** Where the schedule stands, and its next firings when Temporal has it. */
  async get(actor: ScheduleActor, workflowId: string): Promise<Schedule> {
    const row = await this.database.withContext(
      { userId: actor.userId, organizationId: actor.organizationId },
      async (tx) => {
        await findActiveWorkflow(tx, actor.organizationId, workflowId);
        const [found] = await tx
          .select({
            schedule: workflowSchedules,
            versionNumber: workflowVersions.versionNumber,
          })
          .from(workflowSchedules)
          .innerJoin(workflowVersions, eq(workflowVersions.id, workflowSchedules.versionId))
          .where(eq(workflowSchedules.workflowId, workflowId));
        if (!found) throw new ResourceNotFoundException();
        return found;
      },
    );
    const { schedule } = row;
    const nextRuns =
      schedule.desiredState === 'scheduled' && schedule.syncStatus === 'synced'
        ? await this.nextRuns(workflowId)
        : [];
    return {
      desiredState: schedule.desiredState === 'removed' ? 'removed' : 'scheduled',
      syncStatus:
        (['pending', 'synced', 'failed'] as const).find(
          (status) => status === schedule.syncStatus,
        ) ?? 'pending',
      cron: schedule.cron,
      timezone: schedule.timezone,
      versionNumber: row.versionNumber,
      lastErrorCode: schedule.lastErrorCode,
      nextRuns,
    };
  }

  /** The upcoming firings; Temporal being down or the schedule missing only means "none to show". */
  private async nextRuns(workflowId: string): Promise<string[]> {
    const client: Client = this.temporal.client;
    try {
      const description = await this.temporal.withDeadline(() =>
        client.schedule.getHandle(scheduleIdFor(workflowId)).describe(),
      );
      return description.info.nextActionTimes
        .slice(0, SCHEDULE_NEXT_RUNS_MAX)
        .map((time) => time.toISOString());
    } catch (error) {
      if (error instanceof ScheduleNotFoundError) return [];
      return [];
    }
  }
}
