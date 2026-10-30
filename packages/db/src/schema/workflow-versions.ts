import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { bytea } from './types.js';
import { users } from './users.js';
import { workflows } from './workflows.js';

/**
 * A published version of a workflow. Immutable: `app_runtime` can only SELECT and INSERT, and
 * archiving a workflow keeps its versions. No `updated_at` and no `deleted_at` on purpose.
 */
export const workflowVersions = pgTable(
  'workflow_versions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    /** Copy of the workflow's organization, for row-level security. */
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    workflowId: uuid('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'restrict' }),
    versionNumber: integer('version_number').notNull(),
    definition: jsonb('definition').notNull(),
    /** SHA-256 of the canonical JSON form of `definition` (SC-006). */
    definitionHash: bytea('definition_hash').notNull(),
    note: text('note'),
    nodeCount: integer('node_count').notNull(),
    edgeCount: integer('edge_count').notNull(),
    /** Node types used, sorted and without repeats. */
    nodeTypes: text('node_types').array().notNull(),
    publishedBy: uuid('published_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Second layer against two parallel publications of the same draft (R11).
    uniqueIndex('workflow_versions_workflow_number_key').on(table.workflowId, table.versionNumber),
    // Target of the composite foreign key of workflow_active_versions.
    unique('workflow_versions_id_workflow_key').on(table.id, table.workflowId),
    index('workflow_versions_node_types_idx').using('gin', table.nodeTypes),
    check('workflow_versions_number_positive', sql`${table.versionNumber} >= 1`),
    check(
      'workflow_versions_definition_size',
      sql`octet_length(${table.definition}::text) <= 1048576`,
    ),
    check('workflow_versions_hash_length', sql`octet_length(${table.definitionHash}) = 32`),
    check('workflow_versions_note_length', sql`char_length(${table.note}) <= 500`),
    check('workflow_versions_node_count', sql`${table.nodeCount} >= 1`),
    check('workflow_versions_edge_count', sql`${table.edgeCount} >= 0`),
  ],
);
