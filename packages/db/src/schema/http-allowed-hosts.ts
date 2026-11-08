import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { users } from './users.js';

/**
 * Optional allowlist of domains of the organization (F7, decision 9C). Without live rows only the
 * address rules apply; with them the host and every redirect hop must match one. Entries are retired
 * (`removed_at`), never deleted.
 */
export const httpAllowedHosts = pgTable(
  'http_allowed_hosts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    /** Lower-case domain, exact or `*.domain`. */
    pattern: text('pattern').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    removedBy: uuid('removed_by').references(() => users.id, { onDelete: 'restrict' }),
    removedAt: timestamp('removed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('http_allowed_hosts_organization_pattern_active_key')
      .on(table.organizationId, table.pattern)
      .where(sql`${table.removedAt} IS NULL`),
    check(
      'http_allowed_hosts_pattern_length',
      sql`char_length(${table.pattern}) BETWEEN 4 AND 253`,
    ),
    check('http_allowed_hosts_pattern_lower', sql`${table.pattern} = lower(${table.pattern})`),
    check(
      'http_allowed_hosts_pattern_format',
      sql`${table.pattern} ~ '^(\\*\\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'`,
    ),
    check(
      'http_allowed_hosts_pattern_not_ip',
      sql`${table.pattern} !~ '^[0-9.*]+$' AND position(':' in ${table.pattern}) = 0`,
    ),
    check(
      'http_allowed_hosts_removed_pair',
      sql`(${table.removedBy} IS NULL) = (${table.removedAt} IS NULL)`,
    ),
  ],
);
