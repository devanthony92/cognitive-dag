import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { workflowVersions } from './workflow-versions.js';
import { workflows } from './workflows.js';

/**
 * Desired state of the Temporal Schedule `sched-<workflow_id>` and the result of syncing it (F7,
 * research R6). One row per workflow; deactivating does not delete (no DELETE): the row goes to
 * `desired_state = 'removed'`.
 */
export const workflowSchedules = pgTable(
  'workflow_schedules',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'restrict' }),
    versionId: uuid('version_id').notNull(),
    cron: text('cron').notNull(),
    timezone: text('timezone').notNull().default('UTC'),
    desiredState: text('desired_state').notNull().default('scheduled'),
    syncStatus: text('sync_status').notNull().default('pending'),
    syncAttempts: smallint('sync_attempts').notNull().default(0),
    /** Stable code of the last failure, without detail. */
    lastErrorCode: text('last_error_code'),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('workflow_schedules_workflow_id_key').on(table.workflowId),
    foreignKey({
      name: 'workflow_schedules_version_fkey',
      columns: [table.versionId, table.workflowId],
      foreignColumns: [workflowVersions.id, workflowVersions.workflowId],
    }).onDelete('restrict'),
    // What the reconciler walks.
    index('workflow_schedules_unsynced_idx')
      .on(table.syncStatus)
      .where(sql`${table.syncStatus} <> 'synced'`),
    // Counts the active schedules of an organization against its limit.
    index('workflow_schedules_organization_active_idx')
      .on(table.organizationId)
      .where(sql`${table.desiredState} = 'scheduled'`),
    check('workflow_schedules_cron_length', sql`char_length(${table.cron}) BETWEEN 9 AND 100`),
    check(
      'workflow_schedules_timezone_length',
      sql`char_length(${table.timezone}) BETWEEN 1 AND 64`,
    ),
    check(
      'workflow_schedules_desired_state_valid',
      sql`${table.desiredState} IN ('scheduled', 'removed')`,
    ),
    check(
      'workflow_schedules_sync_status_valid',
      sql`${table.syncStatus} IN ('pending', 'synced', 'failed')`,
    ),
    check('workflow_schedules_sync_attempts_non_negative', sql`${table.syncAttempts} >= 0`),
    check(
      'workflow_schedules_last_error_code_length',
      sql`char_length(${table.lastErrorCode}) <= 64`,
    ),
    check(
      'workflow_schedules_sync_consistent',
      sql`(${table.syncStatus} <> 'synced' OR ${table.syncedAt} IS NOT NULL)
        AND ((${table.lastErrorCode} IS NOT NULL) = (${table.syncStatus} = 'failed'))`,
    ),
  ],
);
