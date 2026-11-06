import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { users } from './users.js';
import { workflows } from './workflows.js';

/**
 * One row per compilation of natural language into a DAG (F6, data model). Only metadata: the
 * intent and the generated DAG live in the Temporal history `compile-<id>` (author decision 3B),
 * never here. Mutable along its life cycle (`queued` -> `running` -> `succeeded` | `failed`) and
 * immutable once final.
 */
export const compilations = pgTable(
  'compilations',
  {
    /** The workflow of Temporal is `compile-<id>`. */
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    /** Null in mode `create`; the workflow whose draft is regenerated otherwise. */
    workflowId: uuid('workflow_id').references(() => workflows.id, { onDelete: 'restrict' }),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    mode: text('mode').notNull(),
    baseDraftRevision: integer('base_draft_revision'),
    status: text('status').notNull().default('queued'),
    /** Size of the intent only, never its text. */
    intentChars: integer('intent_chars').notNull(),
    model: text('model').notNull(),
    /** Calls to the provider. */
    calls: smallint('calls').notNull().default(0),
    repairs: smallint('repairs').notNull().default(0),
    /** Reserved and adjusted tokens. */
    llmTokensUsed: integer('llm_tokens_used').notNull().default(0),
    /** Estimated, in micro-USD. */
    costMicroUsd: bigint('cost_micro_usd', { mode: 'number' }).notNull().default(0),
    /** Nodes of the result or of the fallback. */
    nodeCount: smallint('node_count'),
    /** The last attempt can be opened as a draft (research R9). */
    hasFallback: boolean('has_fallback').notNull().default(false),
    errorClass: text('error_class'),
    errorCode: text('error_code'),
    /** Of the HTTP request that created the compilation. */
    correlationId: uuid('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    // Recent list and the daily count per organization (limit of 50 per day, R13).
    index('compilations_organization_created_idx').on(table.organizationId, table.createdAt.desc()),
    index('compilations_workflow_created_idx')
      .on(table.workflowId, table.createdAt.desc())
      .where(sql`${table.workflowId} IS NOT NULL`),
    check('compilations_mode_valid', sql`${table.mode} IN ('create', 'regenerate')`),
    check('compilations_base_draft_revision_positive', sql`${table.baseDraftRevision} >= 1`),
    check(
      'compilations_status_valid',
      sql`${table.status} IN ('queued', 'running', 'succeeded', 'failed')`,
    ),
    check('compilations_intent_chars_range', sql`${table.intentChars} BETWEEN 1 AND 2000`),
    check('compilations_model_length', sql`char_length(${table.model}) BETWEEN 1 AND 64`),
    check('compilations_calls_range', sql`${table.calls} BETWEEN 0 AND 3`),
    check('compilations_repairs_range', sql`${table.repairs} BETWEEN 0 AND 2`),
    check('compilations_llm_tokens_used_non_negative', sql`${table.llmTokensUsed} >= 0`),
    check('compilations_cost_non_negative', sql`${table.costMicroUsd} >= 0`),
    check('compilations_node_count_non_negative', sql`${table.nodeCount} >= 0`),
    check(
      'compilations_error_class_valid',
      sql`${table.errorClass} IN ('transient', 'rate_limited', 'timeout', 'permanent', 'invalid_output', 'budget_exhausted')`,
    ),
    check('compilations_error_code_length', sql`char_length(${table.errorCode}) <= 64`),
    check(
      'compilations_mode_consistent',
      sql`(${table.mode} = 'create' AND ${table.workflowId} IS NULL AND ${table.baseDraftRevision} IS NULL)
        OR (${table.mode} = 'regenerate' AND ${table.workflowId} IS NOT NULL AND ${table.baseDraftRevision} IS NOT NULL)`,
    ),
    check(
      'compilations_error_consistent',
      sql`((${table.status} = 'failed') = (${table.errorCode} IS NOT NULL))
        AND (${table.errorClass} IS NULL OR ${table.status} = 'failed')`,
    ),
    check(
      'compilations_finished_consistent',
      sql`(${table.finishedAt} IS NOT NULL) = (${table.status} IN ('succeeded', 'failed'))`,
    ),
    check(
      'compilations_fallback_only_failed',
      sql`${table.hasFallback} = false OR ${table.status} = 'failed'`,
    ),
  ],
);
