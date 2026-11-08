import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { credentialKind } from './enums.js';
import { organizations } from './organizations.js';
import { bytea } from './types.js';
import { users } from './users.js';

/**
 * Connector credentials with envelope encryption (F7, decision 10B): a data key per credential
 * encrypts the secret and the master key (`CREDENTIALS_MASTER_KEY`, not in the database) encrypts the
 * data key. The `bytea` columns are read only by the worker when it runs a node and by the API when it
 * creates or rotates; every other read uses `credentialMetadata`, which leaves them out.
 */
export const credentials = pgTable(
  'credentials',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    kind: credentialKind('kind').notNull(),
    /** Only for `api_key_header`. */
    headerName: text('header_name'),
    dekWrapped: bytea('dek_wrapped').notNull(),
    dekIv: bytea('dek_iv').notNull(),
    dekTag: bytea('dek_tag').notNull(),
    secretCt: bytea('secret_ct').notNull(),
    secretIv: bytea('secret_iv').notNull(),
    secretTag: bytea('secret_tag').notNull(),
    keyVersion: smallint('key_version').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    rotatedBy: uuid('rotated_by').references(() => users.id, { onDelete: 'restrict' }),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    archivedBy: uuid('archived_by').references(() => users.id, { onDelete: 'restrict' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('credentials_organization_name_active_key')
      .on(table.organizationId, table.name)
      .where(sql`${table.archivedAt} IS NULL`),
    index('credentials_organization_created_idx').on(table.organizationId, table.createdAt.desc()),
    check('credentials_name_length', sql`char_length(${table.name}) BETWEEN 1 AND 64`),
    check('credentials_dek_wrapped_length', sql`octet_length(${table.dekWrapped}) = 32`),
    check('credentials_dek_iv_length', sql`octet_length(${table.dekIv}) = 12`),
    check('credentials_dek_tag_length', sql`octet_length(${table.dekTag}) = 16`),
    check('credentials_secret_ct_length', sql`octet_length(${table.secretCt}) BETWEEN 1 AND 4096`),
    check('credentials_secret_iv_length', sql`octet_length(${table.secretIv}) = 12`),
    check('credentials_secret_tag_length', sql`octet_length(${table.secretTag}) = 16`),
    check('credentials_key_version_positive', sql`${table.keyVersion} >= 1`),
    check(
      'credentials_header_name_consistent',
      sql`(${table.kind} = 'api_key_header') = (${table.headerName} IS NOT NULL)`,
    ),
    check(
      'credentials_header_name_valid',
      sql`${table.headerName} IS NULL OR (
        ${table.headerName} ~ '^[A-Za-z0-9-]{1,64}$'
        AND lower(${table.headerName}) NOT IN ('host', 'content-length', 'content-type', 'transfer-encoding', 'connection', 'cookie', 'set-cookie', 'authorization', 'idempotency-key')
        AND lower(${table.headerName}) NOT LIKE 'proxy-%')`,
    ),
    check(
      'credentials_rotated_pair',
      sql`(${table.rotatedBy} IS NULL) = (${table.rotatedAt} IS NULL)`,
    ),
    check(
      'credentials_archived_pair',
      sql`(${table.archivedBy} IS NULL) = (${table.archivedAt} IS NULL)`,
    ),
  ],
);

/** The columns a credential shows without its secret: the only shape the API reads (T025). */
export const credentialMetadata = {
  id: credentials.id,
  organizationId: credentials.organizationId,
  name: credentials.name,
  kind: credentials.kind,
  headerName: credentials.headerName,
  keyVersion: credentials.keyVersion,
  createdBy: credentials.createdBy,
  createdAt: credentials.createdAt,
  updatedAt: credentials.updatedAt,
  rotatedBy: credentials.rotatedBy,
  rotatedAt: credentials.rotatedAt,
  archivedBy: credentials.archivedBy,
  archivedAt: credentials.archivedAt,
} as const;
