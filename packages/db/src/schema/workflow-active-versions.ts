import { sql } from 'drizzle-orm';
import { check, foreignKey, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations } from './organizations.js';
import { users } from './users.js';
import { workflowVersions } from './workflow-versions.js';
import { workflows } from './workflows.js';

/**
 * Which version of a workflow is active (author decision, option C). A bridge table instead of a
 * column in `workflows` avoids the circular reference and keeps versions immutable. One row per
 * workflow, created together with it; `version_id` NULL means no active version.
 */
export const workflowActiveVersions = pgTable(
  'workflow_active_versions',
  {
    workflowId: uuid('workflow_id')
      .primaryKey()
      .references(() => workflows.id, { onDelete: 'restrict' }),
    /** Copy of the workflow's organization, for row-level security. */
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    versionId: uuid('version_id'),
    activatedBy: uuid('activated_by').references(() => users.id, { onDelete: 'restrict' }),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
  },
  (table) => [
    // The active version always belongs to this workflow.
    foreignKey({
      name: 'workflow_active_versions_version_fkey',
      columns: [table.versionId, table.workflowId],
      foreignColumns: [workflowVersions.id, workflowVersions.workflowId],
    }).onDelete('restrict'),
    check(
      'workflow_active_versions_activated_consistent',
      sql`(${table.versionId} IS NULL) = (${table.activatedAt} IS NULL)`,
    ),
  ],
);
