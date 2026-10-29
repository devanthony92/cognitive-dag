import { sql } from 'drizzle-orm';
import { check, index, inet, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sessionRevokeReason } from './enums.js';
import { bytea } from './types.js';
import { users } from './users.js';

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** SHA-256 of the opaque session token. */
    tokenHash: bytea('token_hash').notNull().unique(),
    csrfTokenHash: bytea('csrf_token_hash').notNull(),
    ip: inet('ip').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Absolute limit: `created_at + 12 h`. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokeReason: sessionRevokeReason('revoke_reason'),
  },
  (table) => [
    // Revokes every session of a user.
    index('sessions_user_active_idx')
      .on(table.userId)
      .where(sql`${table.revokedAt} IS NULL`),
    check('sessions_token_hash_length', sql`octet_length(${table.tokenHash}) = 32`),
    check('sessions_csrf_token_hash_length', sql`octet_length(${table.csrfTokenHash}) = 32`),
    check('sessions_user_agent_length', sql`char_length(${table.userAgent}) <= 512`),
    check(
      'sessions_revocation_consistent',
      sql`(${table.revokedAt} IS NULL) = (${table.revokeReason} IS NULL)`,
    ),
  ],
);
