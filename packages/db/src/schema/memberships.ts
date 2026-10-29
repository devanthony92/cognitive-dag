import { sql } from 'drizzle-orm';
import { index, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { memberRole } from './enums.js';
import { organizations } from './organizations.js';
import { users } from './users.js';

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: memberRole('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('memberships_organization_user_active_key')
      .on(table.organizationId, table.userId)
      .where(sql`${table.deletedAt} IS NULL`),
    // Lists the organizations of a user.
    index('memberships_user_active_idx')
      .on(table.userId)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);
