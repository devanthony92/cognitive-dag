import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { runStatus } from './enums.js';
import { organizations } from './organizations.js';
import { users } from './users.js';
import { workflowVersions } from './workflow-versions.js';
import { workflows } from './workflows.js';

/**
 * One execution of a workflow version. The API generates the id (UUID v7) and inserts the row
 * before starting Temporal; the worker then moves it through its states. No input or output
 * content is stored here (author decision 5C): that lives only in the Temporal history.
 */
export const workflowRuns = pgTable(
  'workflow_runs',
  {
    id: uuid('id').primaryKey(),
    /** Copy of the workflow's organization, for row-level security. */
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'restrict' }),
    versionId: uuid('version_id').notNull(),
    /** Copy of the version number, to list runs without a join. */
    versionNumber: integer('version_number').notNull(),
    status: runStatus('status').notNull().default('queued'),
    /** The person who started the run; null when a webhook or a schedule did (F7, research R14). */
    triggeredBy: uuid('triggered_by').references(() => users.id, { onDelete: 'restrict' }),
    cancelledBy: uuid('cancelled_by').references(() => users.id, { onDelete: 'restrict' }),
    rerunOf: uuid('rerun_of').references((): AnyPgColumn => workflowRuns.id, {
      onDelete: 'restrict',
    }),
    correlationId: uuid('correlation_id').notNull(),
    temporalWorkflowId: text('temporal_workflow_id').notNull(),
    errorCode: text('error_code'),
    /** Short summary without input data. */
    errorMessage: text('error_message'),
    /** Node a rerun started from (F4); only on reruns. */
    rerunFromNodeId: text('rerun_from_node_id'),
    /** Taxonomy class of the failure that ended the run (F4, widened in F5). */
    errorClass: text('error_class'),
    /** Tokens reserved and adjusted by the LLM nodes of the run (F5, research R4). */
    llmTokensUsed: integer('llm_tokens_used').notNull().default(0),
    /** What fired the run (F7): `manual`, `webhook` or `schedule`. */
    triggerKind: text('trigger_kind').notNull().default('manual'),
    /** The `X-Event-Id` of the webhook call (F7). */
    triggerEventId: text('trigger_event_id'),
    /** The programmed time of a scheduled firing (F7). */
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('workflow_runs_temporal_workflow_id_key').on(table.temporalWorkflowId),
    // The executed version always belongs to this workflow.
    foreignKey({
      name: 'workflow_runs_version_fkey',
      columns: [table.versionId, table.workflowId],
      foreignColumns: [workflowVersions.id, workflowVersions.workflowId],
    }).onDelete('restrict'),
    index('workflow_runs_workflow_created_idx').on(table.workflowId, table.createdAt.desc()),
    // Counts the runs in progress of an organization for the concurrency limit.
    index('workflow_runs_organization_in_progress_idx')
      .on(table.organizationId)
      .where(sql`${table.status} IN ('queued', 'running')`),
    check('workflow_runs_version_number_positive', sql`${table.versionNumber} >= 1`),
    check('workflow_runs_error_code_length', sql`char_length(${table.errorCode}) <= 64`),
    check('workflow_runs_error_message_length', sql`char_length(${table.errorMessage}) <= 500`),
    index('workflow_runs_organization_created_idx').on(
      table.organizationId,
      table.createdAt.desc(),
    ),
    index('workflow_runs_organization_failed_idx')
      .on(table.organizationId, table.createdAt.desc())
      .where(sql`${table.status} = 'failed'`),
    check(
      'workflow_runs_rerun_from_node_id_format',
      sql`${table.rerunFromNodeId} ~ '^[a-z][a-z0-9_]{0,39}$'`,
    ),
    check(
      'workflow_runs_rerun_from_requires_rerun',
      sql`${table.rerunFromNodeId} IS NULL OR ${table.rerunOf} IS NOT NULL`,
    ),
    check(
      'workflow_runs_error_class_valid',
      sql`${table.errorClass} IN ('transient', 'rate_limited', 'timeout', 'permanent', 'invalid_output', 'budget_exhausted')`,
    ),
    check('workflow_runs_llm_tokens_used_non_negative', sql`${table.llmTokensUsed} >= 0`),
    check(
      'workflow_runs_error_class_status',
      sql`${table.errorClass} IS NULL OR ${table.status} IN ('failed', 'timed_out')`,
    ),
    check(
      'workflow_runs_finished_consistent',
      sql`(${table.status} IN ('queued', 'running') AND ${table.finishedAt} IS NULL)
        OR (${table.status} IN ('succeeded', 'failed', 'cancelled', 'timed_out') AND ${table.finishedAt} IS NOT NULL)`,
    ),
    check(
      'workflow_runs_cancelled_by_consistent',
      sql`${table.cancelledBy} IS NULL OR ${table.status} = 'cancelled'`,
    ),
    check(
      'workflow_runs_trigger_kind_valid',
      sql`${table.triggerKind} IN ('manual', 'webhook', 'schedule')`,
    ),
    check(
      'workflow_runs_trigger_event_id_length',
      sql`char_length(${table.triggerEventId}) BETWEEN 1 AND 128`,
    ),
    check(
      'workflow_runs_trigger_consistent',
      sql`(${table.triggerKind} = 'manual' AND ${table.triggeredBy} IS NOT NULL
          AND ${table.triggerEventId} IS NULL AND ${table.scheduledAt} IS NULL)
        OR (${table.triggerKind} = 'webhook' AND ${table.triggeredBy} IS NULL
          AND ${table.triggerEventId} IS NOT NULL AND ${table.scheduledAt} IS NULL AND ${table.rerunOf} IS NULL)
        OR (${table.triggerKind} = 'schedule' AND ${table.triggeredBy} IS NULL
          AND ${table.triggerEventId} IS NULL AND ${table.scheduledAt} IS NOT NULL AND ${table.rerunOf} IS NULL)`,
    ),
  ],
);
