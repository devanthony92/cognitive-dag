import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { PROBLEM_CONTENT_TYPE, type Role, type SessionInfo } from '@cognitive-dag/contracts';
import { routerDefaults } from '../src/components/route/router-defaults';
import { routeTree } from '../src/routeTree.gen';

export const ORG_ID = '0192f0a0-0000-7000-8000-0000000000aa';
export const CORRELATION_ID = '0b5f7f5e-3c1a-4d57-9a53-7d9a2a2d6c11';

export function sessionFor(role: Role = 'owner'): SessionInfo {
  return {
    user: { id: '0192f0a0-0000-7000-8000-000000000001', name: 'Ana', email: 'ana@example.com' },
    organizations: [{ id: ORG_ID, name: 'Equipo', role, isPersonal: false }],
    csrfToken: 'c'.repeat(43),
  };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const problem = (status: number, detail: string) =>
  new Response(
    JSON.stringify({
      status,
      title: 'Error',
      detail,
      code: 'INTERNAL_ERROR',
      correlationId: CORRELATION_ID,
    }),
    { status, headers: { 'Content-Type': PROBLEM_CONTENT_TYPE } },
  );

type FetchImpl = (url: string) => Promise<Response>;

/** Renders the real route tree with the production router defaults over a fake `fetch`. */
export function openApp(path: string, impl: FetchImpl) {
  const fetchMock = vi.fn((url: string) => impl(url));
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
    ...routerDefaults,
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, queryClient, fetchMock };
}

/** A signed-in session with empty lists everywhere else. */
export function signedIn(role: Role = 'owner'): FetchImpl {
  return (url) => {
    if (/\/features$/.test(url)) return Promise.resolve(json({}));
    if (/\/auth\/session$/.test(url)) return Promise.resolve(json(sessionFor(role)));
    if (/\/approvals\/count$/.test(url)) return Promise.resolve(json({ pending: 0 }));
    return Promise.resolve(json([]));
  };
}
