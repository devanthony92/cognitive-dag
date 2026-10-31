import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { stepStatus } from './enums.js';
import { organizations } from './organizations.js';
import { workflowRuns } from './workflow-runs.js';

/**
 * State of one node in one run. One row per node and run: a retried write updates the same row.
 * Like the run, it holds no input or output content.
 */
export const workflowRunSteps = pgTable(
  'workflow_run_steps',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    /** Copy of the run's organization, for row-level security. */
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => workflowRuns.id, { onDelete: 'restrict' }),
    nodeId: text('node_id').notNull(),
    nodeType: text('node_type').notNull(),
    status: stepStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('workflow_run_steps_run_node_key').on(table.runId, table.nodeId),
    check('workflow_run_steps_node_id_format', sql`${table.nodeId} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check('workflow_run_steps_node_type_length', sql`char_length(${table.nodeType}) <= 40`),
    check('workflow_run_steps_attempts_non_negative', sql`${table.attempts} >= 0`),
    check('workflow_run_steps_duration_non_negative', sql`${table.durationMs} >= 0`),
    check('workflow_run_steps_error_code_length', sql`char_length(${table.errorCode}) <= 64`),
    check(
      'workflow_run_steps_error_message_length',
      sql`char_length(${table.errorMessage}) <= 500`,
    ),
  ],
);
