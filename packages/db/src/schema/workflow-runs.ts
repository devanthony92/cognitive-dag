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
    triggeredBy: uuid('triggered_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    cancelledBy: uuid('cancelled_by').references(() => users.id, { onDelete: 'restrict' }),
    rerunOf: uuid('rerun_of').references((): AnyPgColumn => workflowRuns.id, {
      onDelete: 'restrict',
    }),
    correlationId: uuid('correlation_id').notNull(),
    temporalWorkflowId: text('temporal_workflow_id').notNull(),
    errorCode: text('error_code'),
    /** Short summary without input data. */
    errorMessage: text('error_message'),
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
    check(
      'workflow_runs_finished_consistent',
      sql`(${table.status} IN ('queued', 'running') AND ${table.finishedAt} IS NULL)
        OR (${table.status} IN ('succeeded', 'failed', 'cancelled', 'timed_out') AND ${table.finishedAt} IS NOT NULL)`,
    ),
    check(
      'workflow_runs_cancelled_by_consistent',
      sql`${table.cancelledBy} IS NULL OR ${table.status} = 'cancelled'`,
    ),
  ],
);
