import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    name: text('name').notNull(),
    isPersonal: boolean('is_personal').notNull().default(false),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // One personal organization per user.
    uniqueIndex('organizations_personal_key')
      .on(table.createdBy)
      .where(sql`${table.isPersonal} AND ${table.deletedAt} IS NULL`),
    check('organizations_name_length', sql`char_length(${table.name}) BETWEEN 1 AND 100`),
    check(
      'organizations_personal_not_deleted',
      sql`NOT (${table.isPersonal} AND ${table.deletedAt} IS NOT NULL)`,
    ),
  ],
);
