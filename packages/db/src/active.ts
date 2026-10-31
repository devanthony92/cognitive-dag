import { and, isNotNull, isNull, type SQL } from 'drizzle-orm';
import { memberships, organizations, users, workflows } from './schema/index.js';
import type { Tx } from './tenant.js';

/**
 * Soft delete (research R3, option A): the row-level security policies of `users`,
 * `organizations`, `memberships` and `workflows` do not test `deleted_at`, because PostgreSQL also applies the
 * SELECT policy to the new row of an UPDATE and would then forbid setting `deleted_at`.
 *
 * RULE: no API query reads these tables except through the helpers below. ESLint forbids
 * `.from(users|organizations|memberships|workflows)` and the join methods in `apps/api`.
 */
export const isActive = {
  users: isNull(users.deletedAt),
  organizations: isNull(organizations.deletedAt),
  memberships: isNull(memberships.deletedAt),
  workflows: isNull(workflows.deletedAt),
} as const;

export const active = {
  users: (tx: Tx, where?: SQL) => tx.select().from(users).where(and(isActive.users, where)),
  organizations: (tx: Tx, where?: SQL) =>
    tx.select().from(organizations).where(and(isActive.organizations, where)),
  memberships: (tx: Tx, where?: SQL) =>
    tx.select().from(memberships).where(and(isActive.memberships, where)),
  workflows: (tx: Tx, where?: SQL) =>
    tx.select().from(workflows).where(and(isActive.workflows, where)),
  /**
   * Only the name: with a pending invitation token the whole organization row is readable
   * (data-model.md, option B), and the invitation preview must not carry more than this.
   */
  organizationNames: (tx: Tx, where?: SQL) =>
    tx
      .select({ name: organizations.name })
      .from(organizations)
      .where(and(isActive.organizations, where)),
};

/**
 * Rows in the opposite state, for the one case that must tell an archived resource from one that
 * never existed (starting a run answers 409 for the first and 404 for the second).
 */
export const archived = {
  workflows: (tx: Tx, where?: SQL) =>
    tx
      .select({ id: workflows.id })
      .from(workflows)
      .where(and(isNotNull(workflows.deletedAt), where)),
};

/**
 * Workflows of any state, only id and name: the runs of an archived workflow keep showing which
 * workflow they belong to (organization runs list).
 */
export const named = {
  workflows: (tx: Tx, where?: SQL) =>
    tx.select({ id: workflows.id, name: workflows.name }).from(workflows).where(where),
};
