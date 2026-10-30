import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';

/**
 * Limits of one organization. Read-only for `app_runtime`: only the operator script, connected as
 * `app_migrator`, writes here (FR-021). No row means the platform defaults apply.
 */
export const organizationLimits = pgTable(
  'organization_limits',
  {
    organizationId: uuid('organization_id')
      .primaryKey()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    maxNodes: integer('max_nodes').notNull(),
    maxEdges: integer('max_edges').notNull(),
    maxDefinitionBytes: integer('max_definition_bytes').notNull(),
    /** Identifier of the operator who made the change. */
    updatedBy: text('updated_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('organization_limits_max_nodes', sql`${table.maxNodes} BETWEEN 1 AND 500`),
    check('organization_limits_max_edges', sql`${table.maxEdges} BETWEEN 0 AND 1000`),
    check(
      'organization_limits_max_definition_bytes',
      sql`${table.maxDefinitionBytes} BETWEEN 1024 AND 1048576`,
    ),
    check(
      'organization_limits_updated_by_length',
      sql`char_length(${table.updatedBy}) BETWEEN 1 AND 100`,
    ),
  ],
);
