import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROBLEM_CONTENT_TYPE, type SessionInfo } from '@cognitive-dag/contracts';
import { routeTree } from '../src/routeTree.gen';

const ORG_ID = '0192f0a0-0000-7000-8000-0000000000aa';
const SESSION: SessionInfo = {
  user: { id: '0192f0a0-0000-7000-8000-000000000001', name: 'Ana', email: 'ana@example.com' },
  organizations: [{ id: ORG_ID, name: 'Equipo', role: 'owner', isPersonal: true }],
  csrfToken: 'c'.repeat(43),
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
const unauthenticated = () =>
  new Response(
    JSON.stringify({
      status: 401,
      title: 'Unauthorized',
      detail: 'Inicia sesión.',
      code: 'UNAUTHENTICATED',
      correlationId: '0b5f7f5e-3c1a-4d57-9a53-7d9a2a2d6c11',
    }),
    { status: 401, headers: { 'Content-Type': PROBLEM_CONTENT_TYPE } },
  );

function open(path: string, signedIn: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (/\/features$/.test(url)) {
        return Promise.resolve(json({ 'identity-enabled': true, 'ping-enabled': true }));
      }
      if (/\/auth\/session$/.test(url)) {
        return Promise.resolve(signedIn ? json(SESSION) : unauthenticated());
      }
      return Promise.resolve(json([]));
    }),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('guest-only routes', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each(['/login', '/register', '/forgot-password'])(
    'redirects a signed-in user from %s to the organization',
    async (path) => {
      const router = open(path, true);
      await waitFor(() => expect(router.state.location.pathname).toBe(`/orgs/${ORG_ID}`));
      expect(screen.queryByRole('button', { name: 'Crear cuenta' })).toBeNull();
    },
  );

  it.each([
    ['/login', 'Iniciar sesión'],
    ['/register', 'Crear cuenta'],
    ['/forgot-password', 'Enviar enlace'],
  ])('shows the form of %s to a signed-out visitor', async (path, button) => {
    const router = open(path, false);
    expect(await screen.findByRole('button', { name: button })).toBeDefined();
    expect(router.state.location.pathname).toBe(path);
  });
});
