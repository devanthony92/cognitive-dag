import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import type { SessionInfo } from '@cognitive-dag/contracts';
import { sessionQuery } from './session';

/** Resolves the session, or sends the visitor to /login. fetchQuery honors staleness. */
export async function requireSession(queryClient: QueryClient): Promise<SessionInfo> {
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

/**
 * For screens meant for visitors (login, registration, password recovery): a signed-in user is sent
 * to their organization. Runs in `beforeLoad`, so the form never flashes while the session loads.
 */
export async function requireGuest(queryClient: QueryClient): Promise<void> {
  const info = await queryClient.fetchQuery(sessionQuery);
  if (info) throw homeRedirect(info);
}
