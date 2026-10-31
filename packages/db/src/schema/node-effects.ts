import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { effectStatus } from './enums.js';
import { organizations } from './organizations.js';
import { workflowRuns } from './workflow-runs.js';

/**
 * The side effect of one node in one run, keyed by `run_id:node_id` (F4, research R4). It is
 * recorded as `started` before the effect runs and `committed` after the destination confirmed
 * it, so a retry or a recovery never repeats a committed effect. Like the run, it holds no input
 * or output content.
 */
export const nodeEffects = pgTable(
  'node_effects',
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
    /** Sent to the destination in every attempt; always `run_id:node_id`. */
    idempotencyKey: text('idempotency_key').notNull(),
    status: effectStatus('status').notNull().default('started'),
    /** Times the effect was tried. */
    attempts: integer('attempts').notNull().default(1),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    committedAt: timestamp('committed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('node_effects_idempotency_key_key').on(table.idempotencyKey),
    index('node_effects_run_idx').on(table.runId),
    check('node_effects_node_id_format', sql`${table.nodeId} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check(
      'node_effects_idempotency_key_format',
      sql`${table.idempotencyKey} = ${table.runId}::text || ':' || ${table.nodeId}`,
    ),
    check('node_effects_attempts_positive', sql`${table.attempts} >= 1`),
    check(
      'node_effects_committed_at_consistent',
      sql`(${table.status} = 'committed' AND ${table.committedAt} IS NOT NULL)
        OR (${table.status} = 'started' AND ${table.committedAt} IS NULL)`,
    ),
  ],
);
