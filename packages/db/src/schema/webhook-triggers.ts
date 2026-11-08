import { sql } from 'drizzle-orm';
import { check, integer, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { bytea } from './types.js';
import { users } from './users.js';
import { workflows } from './workflows.js';

/**
 * The webhook of a workflow (F7, decision 2B). The id goes in the public URL; the secret is the
 * token, of which only the SHA-256 is kept. The row is created with the first token and never
 * deleted: regenerating the token replaces the hash and raises `generation` by one.
 */
export const webhookTriggers = pgTable(
  'webhook_triggers',
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
    tokenHash: bytea('token_hash').notNull(),
    generation: integer('generation').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    generatedBy: uuid('generated_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('webhook_triggers_workflow_id_key').on(table.workflowId),
    check('webhook_triggers_token_hash_length', sql`octet_length(${table.tokenHash}) = 32`),
    check('webhook_triggers_generation_positive', sql`${table.generation} >= 1`),
  ],
);
