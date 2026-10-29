import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { invitationStatus, memberRole } from './enums.js';
import { organizations } from './organizations.js';
import { bytea } from './types.js';
import { users } from './users.js';

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    /** Normalized like `users.email`. */
    email: text('email').notNull(),
    role: memberRole('role').notNull(),
    tokenHash: bytea('token_hash').notNull().unique(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: invitationStatus('status').notNull().default('pending'),
    /** `created_at + 7 days`. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedBy: uuid('accepted_by').references(() => users.id, { onDelete: 'restrict' }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('invitations_pending_key')
      .on(table.organizationId, table.email)
      .where(sql`${table.status} = 'pending'`),
    check('invitations_email_normalized', sql`${table.email} = lower(btrim(${table.email}))`),
    check('invitations_email_length', sql`char_length(${table.email}) BETWEEN 3 AND 254`),
    check('invitations_token_hash_length', sql`octet_length(${table.tokenHash}) = 32`),
    check(
      'invitations_accepted_consistent',
      sql`${table.status} <> 'accepted' OR (${table.acceptedBy} IS NOT NULL AND ${table.acceptedAt} IS NOT NULL)`,
    ),
    check(
      'invitations_revoked_consistent',
      sql`${table.status} <> 'revoked' OR ${table.revokedAt} IS NOT NULL`,
    ),
  ],
);
