import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import type { SessionInfo } from '@cognitive-dag/contracts';
import { featuresQuery, isIdentityEnabled } from '../flags';
import { sessionQuery } from './session';

/** The screens of F1 do not exist for the user while `identity-enabled` is off (FR-033). */
export async function requireIdentity(queryClient: QueryClient): Promise<void> {
  const features = await queryClient.ensureQueryData(featuresQuery);
  if (!isIdentityEnabled(features)) throw redirect({ to: '/' });
}

/** Resolves the session, or sends the visitor to /login. fetchQuery honors staleness. */
export async function requireSession(queryClient: QueryClient): Promise<SessionInfo> {
  await requireIdentity(queryClient);
  const info = await queryClient.fetchQuery(sessionQuery);
  if (!info) throw redirect({ to: '/login' });
  return info;
}

/** Where a signed-in user lands: the first organization (the personal one comes first). */
export function homeRedirect(info: SessionInfo) {
  const first = info.organizations[0];
  return first
    ? redirect({ to: '/orgs/$organizationId', params: { organizationId: first.id } })
    : redirect({ to: '/' });
}
