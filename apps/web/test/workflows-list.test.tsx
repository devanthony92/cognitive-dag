import { QueryClient } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROBLEM_CONTENT_TYPE, type Role, type SessionInfo } from '@cognitive-dag/contracts';
import './flow-polyfills';
import { routeTree } from '../src/routeTree.gen';

const ORG_ID = '0192f0a0-0000-7000-8000-0000000000aa';
const WORKFLOW_ID = '0192f0a0-0000-7000-8000-0000000000f1';
const CORRELATION_ID = '0b5f7f5e-3c1a-4d57-9a53-7d9a2a2d6c11';

const session = (role: Role): SessionInfo => ({
  user: { id: '0192f0a0-0000-7000-8000-000000000001', name: 'Ana', email: 'ana@example.com' },
  organizations: [{ id: ORG_ID, name: 'Equipo', role, isPersonal: false }],
  csrfToken: 'c'.repeat(43),
});

const summary = (name: string, activeVersionNumber: number | null) => ({
  id: WORKFLOW_ID,
  name,
  draftRevision: 2,
  draftUpdatedAt: '2026-10-30T12:00:00.000Z',
  activeVersionNumber,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const problem = (status: number, code: string, detail: string) =>
  new Response(
    JSON.stringify({ status, title: 'Error', detail, code, correlationId: CORRELATION_ID }),
    { status, headers: { 'Content-Type': PROBLEM_CONTENT_TYPE } },
  );

interface Options {
  flag?: boolean;
  role?: Role;
  list?: unknown[];
  create?: () => Response;
}

function open(path: string, { flag = true, role = 'editor', list = [], create }: Options = {}) {
  const fetchMock = vi.fn((url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    if (/\/features$/.test(url)) {
      return Promise.resolve(json({ 'identity-enabled': true, 'dag-editor-enabled': flag }));
    }
    if (/\/auth\/session$/.test(url)) return Promise.resolve(json(session(role)));
    if (/\/workflows$/.test(url) && method === 'GET') return Promise.resolve(json(list));
    if (/\/workflows$/.test(url) && method === 'POST' && create) return Promise.resolve(create());
    if (/\/workflows\/[0-9a-f-]{36}$/.test(url)) {
      return Promise.resolve(
        json({
          ...summary('Soporte', null),
          draft: { schemaVersion: 1, nodes: [], edges: [] },
        }),
      );
    }
    if (/\/versions$/.test(url) || /\/limits$/.test(url)) {
      return Promise.resolve(
        /\/limits$/.test(url)
          ? json({ maxNodes: 50, maxEdges: 100, maxDefinitionBytes: 262144, source: 'default' })
          : json([]),
      );
    }
    return Promise.resolve(problem(404, 'NOT_FOUND', 'No existe.'));
  });
  vi.stubGlobal('fetch', fetchMock);
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
  return { fetchMock, router, user: userEvent.setup() };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('workflows list (US1)', () => {
  it('lists the workflows with the active version of each', async () => {
    open(`/orgs/${ORG_ID}/workflows`, {
      list: [
        summary('Soporte', 3),
        { ...summary('Ventas', null), id: '0192f0a0-0000-7000-8000-0000000000f2' },
      ],
    });

    const row = (await screen.findByRole('link', { name: 'Soporte' })).closest('tr')!;
    expect(within(row).getByText('Versión 3')).toBeDefined();
    const other = screen.getByRole('link', { name: 'Ventas' }).closest('tr')!;
    expect(within(other).getByText('Sin publicar')).toBeDefined();
  });

  it('creates a workflow and opens its editor', async () => {
    const { user, fetchMock, router } = open(`/orgs/${ORG_ID}/workflows`, {
      create: () =>
        json(
          { ...summary('Nuevo flujo', null), draft: { schemaVersion: 1, nodes: [], edges: [] } },
          201,
        ),
    });

    await user.type(await screen.findByLabelText('Nombre del workflow'), 'Nuevo flujo');
    await user.click(screen.getByRole('button', { name: 'Crear workflow' }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/orgs/${ORG_ID}/workflows/${WORKFLOW_ID}`),
    );
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ name: 'Nuevo flujo' });
    expect(await screen.findByRole('complementary', { name: 'Paleta de nodos' })).toBeDefined();
  });

  it('shows the API message when the name is taken', async () => {
    const { user } = open(`/orgs/${ORG_ID}/workflows`, {
      create: () => problem(409, 'WORKFLOW_NAME_TAKEN', 'Ya existe un workflow con ese nombre.'),
    });

    await user.type(await screen.findByLabelText('Nombre del workflow'), 'Soporte');
    await user.click(screen.getByRole('button', { name: 'Crear workflow' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Ya existe un workflow');
  });

  it('does not offer creation to a viewer', async () => {
    open(`/orgs/${ORG_ID}/workflows`, { role: 'viewer', list: [summary('Soporte', 1)] });

    expect(await screen.findByRole('link', { name: 'Soporte' })).toBeDefined();
    expect(screen.queryByLabelText('Nombre del workflow')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Crear workflow' })).toBeNull();
  });
});

describe('dag-editor-enabled', () => {
  it('shows the Workflows entry in the navigation only with the flag on', async () => {
    open(`/orgs/${ORG_ID}`, { flag: true });
    expect(await screen.findByRole('link', { name: 'Workflows' })).toBeDefined();
    cleanup();

    open(`/orgs/${ORG_ID}`, { flag: false });
    await screen.findAllByRole('link', { name: 'Miembros' });
    expect(screen.queryByRole('link', { name: 'Workflows' })).toBeNull();
  });

  it('sends the list and the editor routes back to the organization when the flag is off', async () => {
    const first = open(`/orgs/${ORG_ID}/workflows`, { flag: false });
    await waitFor(() => expect(first.router.state.location.pathname).toBe(`/orgs/${ORG_ID}`));
    cleanup();

    const second = open(`/orgs/${ORG_ID}/workflows/${WORKFLOW_ID}`, { flag: false });
    await waitFor(() => expect(second.router.state.location.pathname).toBe(`/orgs/${ORG_ID}`));
    expect(second.fetchMock.mock.calls.some(([url]) => /\/workflows/.test(url))).toBe(false);
  });
});
