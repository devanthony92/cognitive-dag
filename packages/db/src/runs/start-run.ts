import { and, eq, sql } from 'drizzle-orm';
import { active, archived } from '../active.js';
import {
  organizationLimits,
  workflowActiveVersions,
  workflowRuns,
  workflowVersions,
  workflows,
} from '../schema/index.js';
import { newId, type Tx } from '../tenant.js';

/**
 * What starts a run (F7, research R14). A person starts `manual` runs (and reruns); the system
 * starts the other two, so they carry no user.
 */
export type StartRunTrigger =
  | { kind: 'manual'; userId: string; rerunOf?: string; rerunFromNodeId?: string }
  | { kind: 'webhook'; eventId: string }
  | { kind: 'schedule'; scheduledAt: Date };

export interface StartRunParams {
  organizationId: string;
  workflowId: string;
  correlationId: string;
  trigger: StartRunTrigger;
  /** A rerun from a node stays on the version of the original run. */
  pinnedVersionId?: string;
  /** Runs in progress allowed when the organization has no limits of its own. */
  defaultMaxConcurrentRuns: number;
  /** Id of the Temporal workflow of the run; a webhook derives it from its event id. */
  temporalWorkflowId: (runId: string) => string;
}

export type StartRunRefusal =
  | { ok: false; reason: 'workflow_not_found' }
  | { ok: false; reason: 'workflow_archived' }
  | { ok: false; reason: 'no_active_version' }
  | { ok: false; reason: 'run_limit_reached'; inProgress: number; limit: number }
  /** A webhook event that already started a run: the existing run is returned. */
  | { ok: false; reason: 'duplicate_event'; runId: string };

export type StartRunRow = typeof workflowRuns.$inferSelect;

export interface StartedRun {
  ok: true;
  run: StartRunRow;
  version: { id: string; versionNumber: number; definition: Record<string, unknown> };
}

export type StartRunResult = StartedRun | StartRunRefusal;

/** The maximum of runs in progress for the organization: its own limit or the platform default. */
export async function effectiveMaxConcurrentRuns(
  tx: Tx,
  organizationId: string,
  fallback: number,
): Promise<number> {
  const [row] = await tx
    .select({ max: organizationLimits.maxConcurrentRuns })
    .from(organizationLimits)
    .where(eq(organizationLimits.organizationId, organizationId));
  return row?.max ?? fallback;
}

/**
 * Runs in progress that count against the limit: queued or running, except those waiting for a
 * human decision (F7, research R8). Otherwise a few approvals pending for a day would block the
 * whole organization.
 */
export async function countRunsInProgress(tx: Tx, organizationId: string): Promise<number> {
  const [row] = (
    await tx.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM workflow_runs r
          WHERE r.organization_id = ${organizationId}
            AND r.status IN ('queued', 'running')
            AND NOT EXISTS (
              SELECT 1 FROM approvals a WHERE a.run_id = r.id AND a.status = 'pending'
            )`,
    )
  ).rows;
  return row?.n ?? 0;
}

/**
 * The part of starting a run that is the same for a person, a webhook and a schedule (F7, T039):
 * the active version, the concurrency limit under an advisory lock of the organization, and the
 * insert. Callers decide what comes before (authorization, flags, input validation) and after
 * (asking Temporal to start). It never throws for a refusal; it returns the reason.
 *
 * The transaction must run in the context of `organizationId`.
 */
export async function startRun(tx: Tx, params: StartRunParams): Promise<StartRunResult> {
  const { organizationId, workflowId, trigger } = params;

  const [workflow] = await active.workflows(
    tx,
    and(eq(workflows.id, workflowId), eq(workflows.organizationId, organizationId)),
  );
  if (!workflow) {
    const [gone] = await archived.workflows(
      tx,
      and(eq(workflows.id, workflowId), eq(workflows.organizationId, organizationId)),
    );
    return { ok: false, reason: gone ? 'workflow_archived' : 'workflow_not_found' };
  }

  let versionId = params.pinnedVersionId;
  if (versionId === undefined) {
    const [bridge] = await tx
      .select({ versionId: workflowActiveVersions.versionId })
      .from(workflowActiveVersions)
      .where(eq(workflowActiveVersions.workflowId, workflowId));
    versionId = bridge?.versionId ?? undefined;
  }
  const [version] = versionId
    ? await tx.select().from(workflowVersions).where(eq(workflowVersions.id, versionId))
    : [];
  if (!version) return { ok: false, reason: 'no_active_version' };

  // The lock is held until the transaction commits, so the count below sees every run inserted by
  // a start that went first (SC-005).
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 0))`);

  if (trigger.kind === 'webhook') {
    // The event id deduplicates: the same event never starts a second run.
    const [existing] = await tx
      .select({ id: workflowRuns.id })
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.workflowId, workflowId),
          eq(workflowRuns.triggerKind, 'webhook'),
          eq(workflowRuns.triggerEventId, trigger.eventId),
        ),
      );
    if (existing) return { ok: false, reason: 'duplicate_event', runId: existing.id };
  }

  const limit = await effectiveMaxConcurrentRuns(
    tx,
    organizationId,
    params.defaultMaxConcurrentRuns,
  );
  const inProgress = await countRunsInProgress(tx, organizationId);
  if (inProgress >= limit) return { ok: false, reason: 'run_limit_reached', inProgress, limit };

  const runId = await newId(tx);
  const [run] = await tx
    .insert(workflowRuns)
    .values({
      id: runId,
      organizationId,
      workflowId,
      versionId: version.id,
      versionNumber: version.versionNumber,
      triggeredBy: trigger.kind === 'manual' ? trigger.userId : null,
      triggerKind: trigger.kind,
      triggerEventId: trigger.kind === 'webhook' ? trigger.eventId : null,
      scheduledAt: trigger.kind === 'schedule' ? trigger.scheduledAt : null,
      rerunOf: trigger.kind === 'manual' ? (trigger.rerunOf ?? null) : null,
      rerunFromNodeId: trigger.kind === 'manual' ? (trigger.rerunFromNodeId ?? null) : null,
      correlationId: params.correlationId,
      temporalWorkflowId: params.temporalWorkflowId(runId),
    })
    .returning();
  if (!run) throw new Error('INSERT INTO workflow_runs returned no row');
  return {
    ok: true,
    run,
    version: {
      id: version.id,
      versionNumber: version.versionNumber,
      definition: version.definition as Record<string, unknown>,
    },
  };
}
