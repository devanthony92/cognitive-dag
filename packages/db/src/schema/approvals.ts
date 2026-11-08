import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { approvalStatus } from './enums.js';
import { organizations } from './organizations.js';
import { users } from './users.js';
import { workflowRuns } from './workflow-runs.js';
import { workflows } from './workflows.js';

/**
 * One row per `human.approval` node a run reaches (F7, research R7, R8). The worker creates it with
 * the `approval.requested` event and closes it with `approval.resolved`. It holds no message and no
 * comment: those live only in the Temporal history (decision 5C).
 */
export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'restrict' }),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'restrict' }),
    nodeId: text('node_id').notNull(),
    nodeLabel: text('node_label').notNull(),
    status: approvalStatus('status').notNull().default('pending'),
    /** Copy of `workflow_runs.triggered_by`; null for a webhook or a schedule. Cannot decide. */
    runTriggeredBy: uuid('run_triggered_by').references(() => users.id, { onDelete: 'restrict' }),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'restrict' }),
    hasComment: boolean('has_comment').notNull().default(false),
    notifiedCount: smallint('notified_count').notNull().default(0),
  },
  (table) => [
    uniqueIndex('approvals_run_node_key').on(table.runId, table.nodeId),
    index('approvals_organization_pending_idx')
      .on(table.organizationId, table.requestedAt.desc())
      .where(sql`${table.status} = 'pending'`),
    index('approvals_organization_resolved_idx')
      .on(table.organizationId, table.resolvedAt.desc())
      .where(sql`${table.status} <> 'pending'`),
    check('approvals_node_id_format', sql`${table.nodeId} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check('approvals_node_label_length', sql`char_length(${table.nodeLabel}) BETWEEN 1 AND 100`),
    check('approvals_expires_after_request', sql`${table.expiresAt} > ${table.requestedAt}`),
    check('approvals_notified_count_range', sql`${table.notifiedCount} BETWEEN 0 AND 20`),
    check(
      'approvals_status_consistent',
      sql`(${table.status} = 'pending' AND ${table.resolvedAt} IS NULL AND ${table.decidedBy} IS NULL)
        OR (${table.status} IN ('approved', 'rejected') AND ${table.resolvedAt} IS NOT NULL AND ${table.decidedBy} IS NOT NULL)
        OR (${table.status} IN ('timed_out', 'cancelled') AND ${table.resolvedAt} IS NOT NULL AND ${table.decidedBy} IS NULL)`,
    ),
    check(
      'approvals_comment_needs_decider',
      sql`${table.hasComment} = false OR ${table.decidedBy} IS NOT NULL`,
    ),
  ],
);
