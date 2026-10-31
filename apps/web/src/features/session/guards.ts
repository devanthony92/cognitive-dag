import type { QueryClient } from '@tanstack/react-query';
import { redirect } from '@tanstack/react-router';
import type { SessionInfo } from '@cognitive-dag/contracts';
import { featuresQuery, isDagEditorEnabled, isExecutionEnabled, isIdentityEnabled } from '../flags';
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

/**
 * For screens meant for visitors (login, registration, password recovery): a signed-in user is sent
 * to their organization. Runs in `beforeLoad`, so the form never flashes while the session loads.
 */
export async function requireGuest(queryClient: QueryClient): Promise<void> {
  await requireIdentity(queryClient);
  const info = await queryClient.fetchQuery(sessionQuery);
  if (info) throw homeRedirect(info);
}

/**
 * The workflows screens do not exist for the user while `dag-editor-enabled` is off (F2). The flag
 * only hides the screens; the API authorizes every call regardless of it.
 */
export async function requireDagEditor(
  queryClient: QueryClient,
  organizationId: string,
): Promise<void> {
  const features = await queryClient.ensureQueryData(featuresQuery);
  if (!isDagEditorEnabled(features)) {
    throw redirect({ to: '/orgs/$organizationId', params: { organizationId } });
  }
}

/**
 * The run screens do not exist for the user while `execution-enabled` (or the editor they hang
 * from) is off (F3). The flag only hides the screens; the API authorizes every call regardless.
 */
export async function requireExecution(
  queryClient: QueryClient,
  organizationId: string,
): Promise<void> {
  const features = await queryClient.ensureQueryData(featuresQuery);
  if (!isDagEditorEnabled(features) || !isExecutionEnabled(features)) {
    throw redirect({ to: '/orgs/$organizationId', params: { organizationId } });
  }
}
