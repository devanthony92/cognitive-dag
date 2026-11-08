import { useQuery } from '@tanstack/react-query';
import { sessionQuery } from '../session/session';

/** Shown next to the disabled run controls (F8 US2, ADR-0082). */
export const EXECUTE_BLOCKED_REASON = 'Tu rol no permite ejecutar workflows.';

/**
 * Whether the person may start, cancel and rerun runs in the organization: owner and editor only,
 * like the API (`@RequiredRoles('owner', 'editor')`), which still decides. While the session
 * loads nobody is allowed and no reason is shown yet.
 */
export function useRunPermission(organizationId: string): {
  canExecute: boolean;
  /** Present only when the role is known and does not allow it. */
  blockedReason: string | undefined;
} {
  const session = useQuery(sessionQuery);
  const role = session.data?.organizations.find((item) => item.id === organizationId)?.role;
  const canExecute = role === 'owner' || role === 'editor';
  return {
    canExecute,
    blockedReason: role !== undefined && !canExecute ? EXECUTE_BLOCKED_REASON : undefined,
  };
}
