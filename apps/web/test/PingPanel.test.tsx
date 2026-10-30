import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CORRELATION_ID_HEADER, PROBLEM_CONTENT_TYPE } from '@cognitive-dag/contracts';
import { PingPanel } from '../src/features/ping/PingPanel';

function mockFeatures(flags: Record<string, boolean>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(flags), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ),
  );
}

function renderPanel(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PingPanel />
    </QueryClientProvider>,
  );
}

describe('PingPanel', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('hides the action when ping-enabled is false', async () => {
    mockFeatures({ 'ping-enabled': false });
    renderPanel();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('button', { name: 'Ejecutar ping' })).toBeNull();
  });

  it('shows the action when ping-enabled is true', async () => {
    mockFeatures({ 'ping-enabled': true });
    renderPanel();
    expect(await screen.findByRole('button', { name: 'Ejecutar ping' })).toBeDefined();
  });

  it('shows the problem detail and correlationId when the request fails', async () => {
    const problem = {
      status: 503,
      title: 'Service Unavailable',
      detail: 'El servicio no est� disponible temporalmente. Intenta de nuevo m�s tarde.',
      code: 'SERVICE_UNAVAILABLE',
      correlationId: '0b5f7f5e-3c1a-4d57-9a53-7d9a2a2d6c11',
    };
    const fetchMock = vi.fn((url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === 'POST'
          ? new Response(JSON.stringify(problem), {
              status: 503,
              headers: { 'Content-Type': `${PROBLEM_CONTENT_TYPE}; charset=utf-8` },
            })
          : new Response(JSON.stringify({ 'ping-enabled': true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: 'Ejecutar ping' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(problem.detail);
    expect(alert.textContent).toContain(problem.correlationId);

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    const sent = new Headers(post?.[1]?.headers).get(CORRELATION_ID_HEADER);
    expect(sent).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('PingPanel inside an organization', () => {
  const ORG_ID = '0192f0a0-0000-7000-8000-0000000000aa';

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function mockSession(role: 'owner' | 'editor' | 'viewer'): void {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const body = url.endsWith('/auth/session')
          ? {
              user: { id: '0192f0a0-0000-7000-8000-000000000001', name: 'Ana', email: 'a@e.com' },
              organizations: [{ id: ORG_ID, name: 'Equipo', role, isPersonal: false }],
              csrfToken: 'c'.repeat(43),
            }
          : { 'ping-enabled': true };
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PingPanel organizationId={ORG_ID} />
      </QueryClientProvider>,
    );
  }

  it.each(['owner', 'editor'] as const)('offers the action to a %s', async (role) => {
    mockSession(role);
    expect(await screen.findByRole('button', { name: 'Ejecutar ping' })).toBeDefined();
  });

  it('does not offer the action to a viewer, and says why', async () => {
    mockSession('viewer');
    expect(await screen.findByText(/solo lectura/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Ejecutar ping' })).toBeNull();
  });
});
