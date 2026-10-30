import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROBLEM_CONTENT_TYPE, type Role, type SessionInfo } from '@cognitive-dag/contracts';
import { OrganizationSettings } from '../src/features/organizations/OrganizationSettings';
import { sessionQuery } from '../src/features/session/session';

const ORG_ID = '0192f0a0-0000-7000-8000-0000000000aa';
const OTHER_ID = '0192f0a0-0000-7000-8000-0000000000bb';
const CORRELATION_ID = '0b5f7f5e-3c1a-4d57-9a53-7d9a2a2d6c11';

const session = (role: Role): SessionInfo => ({
  user: { id: '0192f0a0-0000-7000-8000-000000000001', name: 'Ana', email: 'ana@example.com' },
  organizations: [
    { id: ORG_ID, name: 'Equipo', role, isPersonal: false },
    { id: OTHER_ID, name: 'Otra', role: 'owner', isPersonal: true },
  ],
  csrfToken: 'c'.repeat(43),
});

function renderSettings(role: Role) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(sessionQuery.queryKey, session(role));
  render(
    <QueryClientProvider client={client}>
      <OrganizationSettings organizationId={ORG_ID} />
    </QueryClientProvider>,
  );
  return client;
}

describe('OrganizationSettings', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each(['editor', 'viewer'] as const)('is hidden from a %s', (role) => {
    renderSettings(role);
    expect(screen.queryByText('Ajustes de la organización')).toBeNull();
  });

  it('renames through the API and updates the name everywhere at once', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ id: ORG_ID, name: 'Nuevo nombre', role: 'owner', isPersonal: false }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const client = renderSettings('owner');

    expect(screen.getByText('Ajustes de la organización')).toBeDefined();
    const input = screen.getByLabelText<HTMLInputElement>('Nombre de la organización');
    expect(input.value).toBe('Equipo');
    await user.clear(input);
    await user.type(input, '  Nuevo nombre  ');
    await user.click(screen.getByRole('button', { name: 'Guardar nombre' }));

    expect(await screen.findByText('Nombre actualizado.')).toBeDefined();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(new RegExp(`/api/v1/organizations/${ORG_ID}$`));
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'Nuevo nombre' });
    // The switcher and the headers read the organizations from the session query.
    const cached = client.getQueryData<SessionInfo>(sessionQuery.queryKey);
    expect(cached?.organizations.map((organization) => organization.name)).toEqual([
      'Nuevo nombre',
      'Otra',
    ]);
  });

  it('validates the name before calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderSettings('owner');

    await user.clear(screen.getByLabelText('Nombre de la organización'));
    await user.click(screen.getByRole('button', { name: 'Guardar nombre' }));

    expect(await screen.findByText('Debe tener entre 1 y 100 caracteres.')).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the problem when the API refuses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              status: 403,
              title: 'Forbidden',
              detail: 'No tienes permiso para hacer esto.',
              code: 'FORBIDDEN',
              correlationId: CORRELATION_ID,
            }),
            { status: 403, headers: { 'Content-Type': PROBLEM_CONTENT_TYPE } },
          ),
        ),
      ),
    );
    const user = userEvent.setup();
    renderSettings('owner');

    await user.type(screen.getByLabelText('Nombre de la organización'), ' 2');
    await user.click(screen.getByRole('button', { name: 'Guardar nombre' }));

    expect((await screen.findByRole('alert')).textContent).toContain(CORRELATION_ID);
  });
});
