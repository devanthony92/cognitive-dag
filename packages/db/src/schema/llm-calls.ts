import { sql } from 'drizzle-orm';
import {
  bigint,
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
import { workflowRuns } from './workflow-runs.js';

/**
 * One row per attempt of an LLM node that reserved budget, repairs included (F5, data model).
 * Immutable and without content: no prompt and no answer is stored here (author decision 5C).
 */
export const llmCalls = pgTable(
  'llm_calls',
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
    /** Attempt of the activity. */
    attempt: integer('attempt').notNull(),
    repairs: smallint('repairs').notNull().default(0),
    model: text('model').notNull(),
    /** Sum of the reservations of the attempt. */
    reservedTokens: integer('reserved_tokens').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    /** Estimated, in micro-USD. */
    costMicroUsd: bigint('cost_micro_usd', { mode: 'number' }).notNull().default(0),
    outcome: text('outcome').notNull(),
    errorCode: text('error_code'),
    durationMs: integer('duration_ms').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('llm_calls_run_node_idx').on(table.runId, table.nodeId),
    index('llm_calls_organization_created_idx').on(table.organizationId, table.createdAt.desc()),
    check('llm_calls_node_id_format', sql`${table.nodeId} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check(
      'llm_calls_node_type_valid',
      sql`${table.nodeType} IN ('llm.classify', 'llm.extract', 'llm.generate')`,
    ),
    check('llm_calls_attempt_positive', sql`${table.attempt} >= 1`),
    check('llm_calls_repairs_range', sql`${table.repairs} BETWEEN 0 AND 2`),
    check('llm_calls_model_length', sql`char_length(${table.model}) BETWEEN 1 AND 64`),
    check('llm_calls_reserved_tokens_non_negative', sql`${table.reservedTokens} >= 0`),
    check('llm_calls_input_tokens_non_negative', sql`${table.inputTokens} >= 0`),
    check('llm_calls_output_tokens_non_negative', sql`${table.outputTokens} >= 0`),
    check('llm_calls_cost_non_negative', sql`${table.costMicroUsd} >= 0`),
    check(
      'llm_calls_outcome_valid',
      sql`${table.outcome} IN ('succeeded', 'invalid_output', 'failed')`,
    ),
    check('llm_calls_error_code_length', sql`char_length(${table.errorCode}) <= 64`),
    check(
      'llm_calls_error_code_consistent',
      sql`(${table.outcome} = 'succeeded' AND ${table.errorCode} IS NULL)
        OR (${table.outcome} <> 'succeeded' AND ${table.errorCode} IS NOT NULL)`,
    ),
    check('llm_calls_duration_non_negative', sql`${table.durationMs} >= 0`),
  ],
);
