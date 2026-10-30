import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROBLEM_CONTENT_TYPE, type Role, type SessionInfo } from '@cognitive-dag/contracts';
import { AcceptInvitationPanel } from '../src/features/invitations/AcceptInvitationPanel';
import {
  clearPendingInvitation,
  readPendingInvitation,
  rememberPendingInvitation,
} from '../src/features/invitations/pending';
import { MembersPage } from '../src/features/members/MembersPage';

const ORG_ID = '0192f0a0-0000-7000-8000-0000000000aa';
const CORRELATION_ID = '0b5f7f5e-3c1a-4d57-9a53-7d9a2a2d6c11';
const TOKEN = 'T'.repeat(43);

const session = (role: Role, email = 'ana@example.com'): SessionInfo => ({
  user: { id: '0192f0a0-0000-7000-8000-000000000001', name: 'Ana', email },
  organizations: [{ id: ORG_ID, name: 'Equipo', role, isPersonal: false }],
  csrfToken: 'c'.repeat(43),
});

const MEMBERS = [
  {
    membershipId: '0192f0a0-0000-7000-8000-0000000000b1',
    userId: '0192f0a0-0000-7000-8000-000000000001',
    name: 'Ana',
    email: 'ana@example.com',
    role: 'owner',
  },
  {
    membershipId: '0192f0a0-0000-7000-8000-0000000000b2',
    userId: '0192f0a0-0000-7000-8000-000000000002',
    name: 'Beto',
    email: 'beto@example.com',
    role: 'viewer',
  },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const problem = (status: number, code: string, detail = 'Detalle del error.') =>
  new Response(
    JSON.stringify({ status, title: 'Error', detail, code, correlationId: CORRELATION_ID }),
    { status, headers: { 'Content-Type': PROBLEM_CONTENT_TYPE } },
  );

type Handler = (url: string, init: RequestInit) => Response | undefined;

function stubApi(...handlers: Handler[]) {
  const fetchMock = vi.fn((url: string, init: RequestInit = {}) => {
    for (const handler of handlers) {
      const response = handler(url, init);
      if (response) return Promise.resolve(response);
    }
    return Promise.resolve(problem(404, 'NOT_FOUND'));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const whenPath =
  (suffix: RegExp, method: string, respond: (init: RequestInit) => Response): Handler =>
  (url, init) =>
    suffix.test(url) && (init.method ?? 'GET') === method ? respond(init) : undefined;

function renderWithClient(element: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
  return client;
}

function renderWithRouter(element: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree: createRootRoute({ component: () => element }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('MembersPage', () => {
  const sessionHandler = (role: Role) =>
    whenPath(/\/auth\/session$/, 'GET', () => json(session(role)));
  const membersHandler = whenPath(/\/members$/, 'GET', () => json(MEMBERS));

  it('gives an owner the invite form, role selects and remove buttons', async () => {
    stubApi(
      sessionHandler('owner'),
      membersHandler,
      whenPath(/\/invitations$/, 'GET', () => json([])),
    );
    renderWithClient(<MembersPage organizationId={ORG_ID} />);

    expect(await screen.findByLabelText('Rol de Beto')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Quitar a Beto' })).toBeDefined();
    expect(await screen.findByRole('button', { name: 'Enviar invitación' })).toBeDefined();
    expect(await screen.findByText('No hay invitaciones pendientes.')).toBeDefined();
  });

  it('shows an editor the list only', async () => {
    const fetchMock = stubApi(sessionHandler('editor'), membersHandler);
    renderWithClient(<MembersPage organizationId={ORG_ID} />);

    expect(await screen.findByText('Beto')).toBeDefined();
    expect(screen.queryByLabelText('Rol de Beto')).toBeNull();
    expect(screen.queryByRole('button', { name: /Quitar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enviar invitación' })).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => /\/invitations/.test(url))).toBe(false);
  });

  it('sends the chosen role when an owner changes it', async () => {
    const fetchMock = stubApi(
      sessionHandler('owner'),
      membersHandler,
      whenPath(/\/invitations$/, 'GET', () => json([])),
      whenPath(/\/members\/[0-9a-f-]{36}$/, 'PATCH', () => json({ ...MEMBERS[1], role: 'editor' })),
    );
    const user = userEvent.setup();
    renderWithClient(<MembersPage organizationId={ORG_ID} />);

    await user.selectOptions(await screen.findByLabelText('Rol de Beto'), 'editor');

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch).toBeDefined();
      expect(JSON.parse((patch![1] as RequestInit).body as string)).toEqual({ role: 'editor' });
    });
  });

  it('shows the API message when the last owner is protected', async () => {
    stubApi(
      sessionHandler('owner'),
      membersHandler,
      whenPath(/\/invitations$/, 'GET', () => json([])),
      whenPath(/\/members\/[0-9a-f-]{36}$/, 'PATCH', () =>
        problem(409, 'LAST_OWNER', 'La organización debe conservar al menos un owner.'),
      ),
    );
    const user = userEvent.setup();
    renderWithClient(<MembersPage organizationId={ORG_ID} />);

    await user.selectOptions(await screen.findByLabelText('Rol de Ana'), 'viewer');

    expect((await screen.findByRole('alert')).textContent).toContain('al menos un owner');
  });

  it('asks for confirmation before removing a member', async () => {
    const fetchMock = stubApi(
      sessionHandler('owner'),
      membersHandler,
      whenPath(/\/invitations$/, 'GET', () => json([])),
      whenPath(/\/members\/[0-9a-f-]{36}$/, 'DELETE', () => new Response(null, { status: 204 })),
    );
    const user = userEvent.setup();
    renderWithClient(<MembersPage organizationId={ORG_ID} />);

    await user.click(await screen.findByRole('button', { name: 'Quitar a Beto' }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Quitar miembro' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true),
    );
  });

  it('invites by email and role and lists the pending invitations', async () => {
    const pending = {
      id: '0192f0a0-0000-7000-8000-0000000000c1',
      email: 'nueva@example.com',
      role: 'editor',
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    };
    const fetchMock = stubApi(
      sessionHandler('owner'),
      membersHandler,
      whenPath(/\/invitations$/, 'POST', () => json(pending, 201)),
      whenPath(/\/invitations$/, 'GET', () => json([])),
    );
    const user = userEvent.setup();
    renderWithClient(<MembersPage organizationId={ORG_ID} />);

    await user.type(await screen.findByLabelText('Correo de la persona'), ' Nueva@Example.com ');
    await user.selectOptions(screen.getByLabelText('Rol'), 'editor');
    await user.click(screen.getByRole('button', { name: 'Enviar invitación' }));

    expect(await screen.findByText('Invitación enviada a nueva@example.com.')).toBeDefined();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({
      email: 'nueva@example.com',
      role: 'editor',
    });
  });
});

describe('AcceptInvitationPanel', () => {
  const previewHandler = whenPath(/\/invitations\/preview$/, 'POST', () =>
    json({ organizationName: 'Laboratorio', email: 'ana@example.com', role: 'editor' }),
  );

  beforeEach(() => clearPendingInvitation());

  it('previews the invitation and keeps it for a later sign-in', async () => {
    const fetchMock = stubApi(
      previewHandler,
      whenPath(/\/auth\/session$/, 'GET', () => problem(401, 'UNAUTHENTICATED')),
    );
    renderWithRouter(<AcceptInvitationPanel token={TOKEN} />);

    expect(await screen.findByText('Invitación a Laboratorio')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Crear cuenta' })).toBeDefined();
    const preview = fetchMock.mock.calls.find(([url]) => /preview$/.test(url))!;
    expect(preview[0]).not.toContain(TOKEN);
    expect(JSON.parse((preview[1] as RequestInit).body as string)).toEqual({ token: TOKEN });
    await waitFor(() =>
      expect(readPendingInvitation()).toEqual({ token: TOKEN, email: 'ana@example.com' }),
    );
  });

  it('accepts for the invited account', async () => {
    const fetchMock = stubApi(
      previewHandler,
      whenPath(/\/auth\/session$/, 'GET', () => json(session('owner', 'ana@example.com'))),
      whenPath(/\/invitations\/accept$/, 'POST', () =>
        json({ id: ORG_ID, name: 'Laboratorio', role: 'editor', isPersonal: false }),
      ),
    );
    rememberPendingInvitation({ token: TOKEN });
    const user = userEvent.setup();
    renderWithRouter(<AcceptInvitationPanel token={TOKEN} />);

    await user.click(await screen.findByRole('button', { name: 'Aceptar invitación' }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => /invitations\/accept$/.test(url))).toBe(true),
    );
    await waitFor(() => expect(readPendingInvitation()).toBeUndefined());
  });

  it('does not offer to accept with another account', async () => {
    stubApi(
      previewHandler,
      whenPath(/\/auth\/session$/, 'GET', () => json(session('owner', 'otra@example.com'))),
    );
    renderWithRouter(<AcceptInvitationPanel token={TOKEN} />);

    expect((await screen.findByRole('alert')).textContent).toContain('ana@example.com');
    expect(screen.getByRole('button', { name: 'Aceptar invitación' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('explains an invalid link and forgets it', async () => {
    rememberPendingInvitation({ token: TOKEN });
    stubApi(
      whenPath(/\/invitations\/preview$/, 'POST', () => problem(422, 'TOKEN_INVALID')),
      whenPath(/\/auth\/session$/, 'GET', () => problem(401, 'UNAUTHENTICATED')),
    );
    renderWithRouter(<AcceptInvitationPanel token={TOKEN} />);

    expect(await screen.findByText('Invitación no válida')).toBeDefined();
    await waitFor(() => expect(readPendingInvitation()).toBeUndefined());
  });
});
