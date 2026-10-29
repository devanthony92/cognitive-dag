import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/** Global identity; does not belong to an organization. */
export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    email: text('email').notNull(),
    name: text('name').notNull(),
    /** PHC string of an Argon2id hash. */
    passwordHash: text('password_hash').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('users_email_active_key')
      .on(table.email)
      .where(sql`${table.deletedAt} IS NULL`),
    check('users_email_normalized', sql`${table.email} = lower(btrim(${table.email}))`),
    check('users_email_length', sql`char_length(${table.email}) BETWEEN 3 AND 254`),
    check('users_name_length', sql`char_length(${table.name}) BETWEEN 1 AND 100`),
  ],
);
