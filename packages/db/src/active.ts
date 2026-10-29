import { and, isNull, type SQL } from 'drizzle-orm';
import { memberships, organizations, users } from './schema/index.js';
import type { Tx } from './tenant.js';

/**
 * Soft delete (research R3, option A): the row-level security policies of `users`,
 * `organizations` and `memberships` do not test `deleted_at`, because PostgreSQL also applies the
 * SELECT policy to the new row of an UPDATE and would then forbid setting `deleted_at`.
 *
 * RULE: no API query reads these three tables except through the helpers below. ESLint forbids
 * `.from(users|organizations|memberships)` and the join methods in `apps/api`.
 */
export const isActive = {
  users: isNull(users.deletedAt),
  organizations: isNull(organizations.deletedAt),
  memberships: isNull(memberships.deletedAt),
} as const;

export const active = {
  users: (tx: Tx, where?: SQL) => tx.select().from(users).where(and(isActive.users, where)),
  organizations: (tx: Tx, where?: SQL) =>
    tx.select().from(organizations).where(and(isActive.organizations, where)),
  memberships: (tx: Tx, where?: SQL) =>
    tx.select().from(memberships).where(and(isActive.memberships, where)),
};
