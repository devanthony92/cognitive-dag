import type { Role } from '@cognitive-dag/contracts';
import type { TenantContext } from '@cognitive-dag/db';
import type { AuthSession } from '../auth/session.service';

/** The organization a request acts on, set only by `OrganizationGuard` after checking membership. */
export interface RequestTenant {
  organizationId: string;
  membershipId: string;
  role: Role;
}

/**
 * Row-level security context of a request. The organization comes from the guard's verdict and
 * never from the URL: if the guard is bypassed there is no organization in the context and the
 * database shows nothing of any organization (R8).
 */
export function tenantContextOf(auth: AuthSession, tenant?: RequestTenant): TenantContext {
  return {
    userId: auth.userId,
    ...(tenant ? { organizationId: tenant.organizationId } : {}),
  };
}
