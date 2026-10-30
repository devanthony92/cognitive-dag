import type { Role } from '@cognitive-dag/contracts';

export interface MemberRef {
  membershipId: string;
  role: Role;
}

/**
 * FR-024: an organization always keeps one active owner. True when applying `change` to the
 * membership would take away the last one. The database trigger `memberships_keep_owner` is the
 * second layer; this check gives the owner a clear message first.
 */
export function wouldLeaveNoOwner(
  members: readonly MemberRef[],
  membershipId: string,
  change: { role: Role } | { remove: true },
): boolean {
  const target = members.find((member) => member.membershipId === membershipId);
  if (target?.role !== 'owner') return false;
  if ('role' in change && change.role === 'owner') return false;
  return !members.some((member) => member.membershipId !== membershipId && member.role === 'owner');
}
