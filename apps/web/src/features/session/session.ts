import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { SessionInfoSchema, type SessionInfo } from '@cognitive-dag/contracts';
import { ApiProblemError, request, setCsrfToken } from '../../api/client';

export const sessionQuery = queryOptions({
  queryKey: ['session'],
  // Null means "nobody is signed in", which is an answer and not an error.
  queryFn: async (): Promise<SessionInfo | null> => {
    try {
      const { data } = await request('/api/v1/auth/session', SessionInfoSchema);
      setCsrfToken(data.csrfToken);
      return data;
    } catch (error) {
      if (error instanceof ApiProblemError && error.problem.code === 'UNAUTHENTICATED') {
        setCsrfToken(null);
        return null;
      }
      throw error;
    }
  },
  staleTime: 30_000,
});

/** Stores a fresh session (after login) so protected routes see it without another request. */
export function rememberSession(queryClient: QueryClient, info: SessionInfo): void {
  setCsrfToken(info.csrfToken);
  queryClient.setQueryData(sessionQuery.queryKey, info);
}

/** Forgets the session and everything fetched under it. */
export function forgetSession(queryClient: QueryClient): void {
  setCsrfToken(null);
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'features' });
  queryClient.setQueryData(sessionQuery.queryKey, null);
}

export const NoBodySchema = z.undefined();

export async function logout(): Promise<void> {
  await request('/api/v1/auth/logout', NoBodySchema, { method: 'POST' });
}
