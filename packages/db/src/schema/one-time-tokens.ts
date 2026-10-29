import { sql } from 'drizzle-orm';
import { check, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tokenPurpose } from './enums.js';
import { bytea } from './types.js';
import { users } from './users.js';

/** Email verification (24 h) and password reset (30 min) tokens; only the hash is stored. */
export const oneTimeTokens = pgTable(
  'one_time_tokens',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    purpose: tokenPurpose('purpose').notNull(),
    tokenHash: bytea('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('one_time_tokens_token_hash_length', sql`octet_length(${table.tokenHash}) = 32`),
  ],
);
