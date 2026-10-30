import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { users } from './users.js';

/**
 * A workflow with its draft. The draft may contain validation errors (FR-010): only its size is
 * limited in the database. Archived (`deleted_at`) rows are filtered in `packages/db` (option A).
 */
export const workflows = pgTable(
  'workflows',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    draftDefinition: jsonb('draft_definition')
      .notNull()
      .default(sql`'{"schemaVersion":1,"nodes":[],"edges":[]}'::jsonb`),
    /** Optimistic locking: increased on every save. */
    draftRevision: integer('draft_revision').notNull().default(1),
    draftUpdatedBy: uuid('draft_updated_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    draftUpdatedAt: timestamp('draft_updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('workflows_organization_name_active_key')
      .on(table.organizationId, table.name)
      .where(sql`${table.deletedAt} IS NULL`),
    index('workflows_organization_active_idx')
      .on(table.organizationId)
      .where(sql`${table.deletedAt} IS NULL`),
    check('workflows_name_length', sql`char_length(${table.name}) BETWEEN 1 AND 100`),
    check(
      'workflows_draft_definition_size',
      sql`octet_length(${table.draftDefinition}::text) <= 1048576`,
    ),
    check('workflows_draft_revision_positive', sql`${table.draftRevision} >= 1`),
  ],
);
