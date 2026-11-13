import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROBLEM_CONTENT_TYPE, type Role, type SessionInfo } from '@cognitive-dag/contracts';
import { ApprovalsBadge } from '../src/features/approvals/ApprovalsBadge';
import { ApprovalsPage } from '../src/features/approvals/ApprovalsPage';
import { ConnectionsPage } from '../src/features/credentials/ConnectionsPage';
import { ScheduleStatus } from '../src/features/schedules/ScheduleStatus';
import { WebhookPanel } from '../src/features/webhooks/WebhookPanel';
import { originOf } from '../src/features/runs/status';
import { Palette } from '../src/features/workflows/Palette';

const ORG_ID = '0192f0a0-0000-7000-8000-0000000000aa';
const WORKFLOW_ID = '0192f0a0-0000-7000-8000-0000000000cc';
const APPROVAL_ID = '0192f0a0-0000-7000-8000-0000000000dd';
const CORRELATION_ID = '0b5f7f5e-3c1a-4d57-9a53-7d9a2a2d6c11';
const WHEN = '2026-11-07T15:00:00.000Z';
// A recognizable stand-in for a token or a secret; it is not one.
const TOKEN_URL = `http://localhost:3000/api/v1/hooks/${WORKFLOW_ID}/cdw_${'A'.repeat(43)}`;
// Built at run time so no secret-looking literal sits in the repository.
const SECRET = ['secret', 'canary', '0002'].join('-');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const problem = (status: number, code: string, detail = 'Detalle del error.') =>
  new Response(
    JSON.stringify({ status, title: 'Error', detail, code, correlationId: CORRELATION_ID }),
    { status, headers: { 'Content-Type': PROBLEM_CONTENT_TYPE } },
  );
/** The JSON text a request was sent with (the stubs only see strings). */
const bodyText = (init?: RequestInit): string => (typeof init?.body === 'string' ? init.body : '');
const empty = (status = 204) => new Response(null, { status });

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
  (
    suffix: RegExp,
    method: string,
    respond: (init: RequestInit, url: string) => Response,
  ): Handler =>
  (url, init) =>
    suffix.test(url) && (init.method ?? 'GET') === method ? respond(init, url) : undefined;

const session = (role: Role): SessionInfo => ({
  user: { id: '0192f0a0-0000-7000-8000-000000000001', name: 'Ana', email: 'ana@example.com' },
  organizations: [{ id: ORG_ID, name: 'Equipo', role, isPersonal: false }],
  csrfToken: 'c'.repeat(43),
});
const sessionAs = (role: Role) => whenPath(/\/auth\/session$/, 'GET', () => json(session(role)));

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
});

const approval = (overrides: Record<string, unknown> = {}) => ({
  id: APPROVAL_ID,
  runId: '0192f0a0-0000-7000-8000-0000000000ee',
  workflowId: WORKFLOW_ID,
  workflowName: 'Pedidos',
  nodeId: 'ask',
  nodeLabel: 'Aprobar pedido',
  status: 'pending',
  requestedAt: WHEN,
  expiresAt: '2026-11-08T15:00:00.000Z',
  resolvedAt: null,
  decidedBy: null,
  hasComment: false,
  canDecide: true,
  ...overrides,
});

describe('approvals inbox and counter', () => {
  it('shows loading, then the empty state', async () => {
    stubApi(whenPath(/\/approvals\?/, 'GET', () => json({ items: [], nextCursor: null })));
    renderWithRouter(<ApprovalsPage organizationId={ORG_ID} selectedId={undefined} />);
    expect(await screen.findByRole('status')).toBeDefined();
    expect(await screen.findByText('No tienes solicitudes pendientes.')).toBeDefined();
  });

  it('shows the error of the API', async () => {
    stubApi(
      whenPath(/\/approvals\?/, 'GET', () => problem(403, 'FORBIDDEN', 'Tu rol no permite.')),
    );
    renderWithRouter(<ApprovalsPage organizationId={ORG_ID} selectedId={undefined} />);
    expect(await screen.findByText('Tu rol no permite.')).toBeDefined();
  });

  it('lists the pending requests and the history in its own tab', async () => {
    const fetchMock = stubApi(
      whenPath(/status=pending/, 'GET', () => json({ items: [approval()], nextCursor: null })),
      whenPath(/status=resolved/, 'GET', () =>
        json({
          items: [
            approval({
              status: 'approved',
              resolvedAt: WHEN,
              decidedBy: { id: '0192f0a0-0000-7000-8000-000000000002', name: 'Beto' },
              canDecide: false,
            }),
          ],
          nextCursor: null,
        }),
      ),
    );
    renderWithRouter(<ApprovalsPage organizationId={ORG_ID} selectedId={undefined} />);
    expect(await screen.findByText('Aprobar pedido')).toBeDefined();
    await userEvent.click(screen.getByRole('tab', { name: 'Historial' }));
    expect(await screen.findByText('Aprobada por Beto')).toBeDefined();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('status=resolved'))).toBe(
      true,
    );
  });

  it('shows the count in the top bar, and nothing while there is none', async () => {
    stubApi(whenPath(/\/approvals\/count$/, 'GET', () => json({ pending: 3 })));
    renderWithRouter(<ApprovalsBadge organizationId={ORG_ID} />);
    expect((await screen.findByTestId('approvals-count')).textContent).toBe('3');
    cleanup();

    stubApi(whenPath(/\/approvals\/count$/, 'GET', () => json({ pending: 0 })));
    renderWithRouter(<ApprovalsBadge organizationId={ORG_ID} />);
    expect(await screen.findByRole('link', { name: 'Aprobaciones' })).toBeDefined();
    expect(screen.queryByTestId('approvals-count')).toBeNull();
  });

  it('keeps the link when the count cannot be read', async () => {
    stubApi(whenPath(/\/approvals\/count$/, 'GET', () => problem(500, 'INTERNAL_ERROR')));
    renderWithRouter(<ApprovalsBadge organizationId={ORG_ID} />);
    expect(await screen.findByRole('link', { name: 'Aprobaciones' })).toBeDefined();
    expect(screen.queryByTestId('approvals-count')).toBeNull();
  });
});

describe('approval detail and decision', () => {
  const detail = (overrides: Record<string, unknown> = {}) =>
    whenPath(new RegExp(`/approvals/${APPROVAL_ID}$`), 'GET', () =>
      json({ ...approval(overrides), message: 'Aprueba el pedido 42', comment: null }),
    );
  const list = whenPath(/\/approvals\?/, 'GET', () => json({ items: [], nextCursor: null }));

  it('shows the message and sends the decision with an optional comment', async () => {
    const fetchMock = stubApi(
      detail(),
      list,
      whenPath(/\/approvals\/count$/, 'GET', () => json({ pending: 0 })),
      whenPath(new RegExp(`/approvals/${APPROVAL_ID}/decision$`), 'POST', () =>
        json(approval({ status: 'approved', canDecide: false })),
      ),
    );
    renderWithRouter(<ApprovalsPage organizationId={ORG_ID} selectedId={APPROVAL_ID} />);
    expect(await screen.findByText('Aprueba el pedido 42')).toBeDefined();

    await userEvent.type(screen.getByLabelText('Comentario (opcional)'), 'Todo en orden');
    await userEvent.click(screen.getByRole('button', { name: 'Aprobar' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/decision'));
      expect(call).toBeDefined();
      expect(JSON.parse(bodyText(call![1]))).toEqual({
        decision: 'approved',
        comment: 'Todo en orden',
      });
    });
  });

  it('decides without a comment', async () => {
    const fetchMock = stubApi(
      detail(),
      list,
      whenPath(new RegExp(`/approvals/${APPROVAL_ID}/decision$`), 'POST', () =>
        json(approval({ status: 'rejected', canDecide: false })),
      ),
    );
    renderWithRouter(<ApprovalsPage organizationId={ORG_ID} selectedId={APPROVAL_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Rechazar' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/decision'));
      expect(JSON.parse(bodyText(call![1]))).toEqual({ decision: 'rejected' });
    });
  });

  it('shows the 409 of a request someone else already decided', async () => {
    stubApi(
      detail(),
      list,
      whenPath(new RegExp(`/approvals/${APPROVAL_ID}/decision$`), 'POST', () =>
        problem(409, 'APPROVAL_ALREADY_RESOLVED', 'Esta solicitud ya fue resuelta.'),
      ),
    );
    renderWithRouter(<ApprovalsPage organizationId={ORG_ID} selectedId={APPROVAL_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Aprobar' }));
    expect(await screen.findByText('Esta solicitud ya fue resuelta.')).toBeDefined();
  });

  it('offers no decision on a run the person started, and says why', async () => {
    stubApi(detail({ canDecide: false }), list);
    renderWithRouter(<ApprovalsPage organizationId={ORG_ID} selectedId={APPROVAL_ID} />);
    expect(
      await screen.findByText('Iniciaste esta ejecución, así que la decide otra persona.'),
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Aprobar' })).toBeNull();
  });

  it('explains an expired history and keeps the metadata', async () => {
    stubApi(
      whenPath(new RegExp(`/approvals/${APPROVAL_ID}$`), 'GET', () =>
        problem(410, 'APPROVAL_CONTENT_EXPIRED'),
      ),
      list,
    );
    renderWithRouter(<ApprovalsPage organizationId={ORG_ID} selectedId={APPROVAL_ID} />);
    expect(await screen.findByText(/el historial del motor venció/)).toBeDefined();
  });
});

describe('webhook panel', () => {
  const state = {
    urlBase: `http://localhost:3000/api/v1/hooks/${WORKFLOW_ID}/`,
    generation: 1,
    generatedAt: WHEN,
    generatedBy: { id: '0192f0a0-0000-7000-8000-000000000001', name: 'Ana' },
    active: true,
  };
  const webhookPath = /\/webhook$/;
  const tokenPath = /\/webhook\/token$/;

  it('offers to generate the first token, shows the URL once and never again', async () => {
    let generated = false;
    stubApi(
      whenPath(webhookPath, 'GET', () => (generated ? json(state) : problem(404, 'NOT_FOUND'))),
      whenPath(tokenPath, 'POST', () => {
        generated = true;
        return json({ ...state, url: TOKEN_URL }, 201);
      }),
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderWithClient(<WebhookPanel organizationId={ORG_ID} workflowId={WORKFLOW_ID} canWrite />);

    expect(await screen.findByText('Todavía no hay un token para este webhook.')).toBeDefined();
    await userEvent.click(screen.getByRole('button', { name: 'Generar token' }));
    expect((await screen.findByTestId('webhook-url')).textContent).toBe(TOKEN_URL);

    await userEvent.click(screen.getByRole('button', { name: /Copiar URL/ }));
    expect(writeText).toHaveBeenCalledWith(TOKEN_URL);
    expect(await screen.findByText('URL copiada.')).toBeDefined();

    // Hiding it, or coming back later, leaves only the state: the token is gone.
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar' }));
    expect(screen.queryByTestId('webhook-url')).toBeNull();
    expect(document.body.textContent).not.toContain('cdw_');
    expect(screen.getByText(/Generación 1/)).toBeDefined();
  });

  it('asks for confirmation before regenerating', async () => {
    const fetchMock = stubApi(
      whenPath(webhookPath, 'GET', () => json(state)),
      whenPath(tokenPath, 'POST', () => json({ ...state, generation: 2, url: TOKEN_URL }, 201)),
    );
    renderWithClient(<WebhookPanel organizationId={ORG_ID} workflowId={WORKFLOW_ID} canWrite />);
    await userEvent.click(await screen.findByRole('button', { name: 'Regenerar token' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/deja de funcionar de inmediato/)).toBeDefined();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/token'))).toBe(false);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Regenerar' }));
    expect((await screen.findByTestId('webhook-url')).textContent).toBe(TOKEN_URL);
  });

  it('shows a viewer the state without the buttons, and warns when no version is active', async () => {
    stubApi(whenPath(webhookPath, 'GET', () => json({ ...state, active: false })));
    renderWithClient(
      <WebhookPanel organizationId={ORG_ID} workflowId={WORKFLOW_ID} canWrite={false} />,
    );
    expect(await screen.findByText(/Sin versión activa con este disparador/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Regenerar token' })).toBeNull();
  });
});

describe('schedule status', () => {
  it('shows the cron, the sync state and the next firings', async () => {
    stubApi(
      whenPath(/\/schedule$/, 'GET', () =>
        json({
          desiredState: 'scheduled',
          syncStatus: 'synced',
          cron: '0 9 * * *',
          timezone: 'America/Bogota',
          versionNumber: 2,
          lastErrorCode: null,
          nextRuns: [WHEN],
        }),
      ),
    );
    renderWithClient(<ScheduleStatus organizationId={ORG_ID} workflowId={WORKFLOW_ID} />);
    expect(await screen.findByText('0 9 * * *')).toBeDefined();
    expect(screen.getByText('Sincronizada con el motor.')).toBeDefined();
    expect(screen.getByText(/con la versión 2/)).toBeDefined();
    expect(screen.getByText('Próximos disparos')).toBeDefined();
  });

  it('says it is pending, and says so when the workflow has no schedule', async () => {
    stubApi(
      whenPath(/\/schedule$/, 'GET', () =>
        json({
          desiredState: 'scheduled',
          syncStatus: 'pending',
          cron: '*/5 * * * *',
          timezone: 'UTC',
          versionNumber: 1,
          lastErrorCode: null,
          nextRuns: [],
        }),
      ),
    );
    renderWithClient(<ScheduleStatus organizationId={ORG_ID} workflowId={WORKFLOW_ID} />);
    expect(await screen.findByText(/Pendiente: el motor la aplicará/)).toBeDefined();
    cleanup();

    stubApi(whenPath(/\/schedule$/, 'GET', () => problem(404, 'NOT_FOUND')));
    renderWithClient(<ScheduleStatus organizationId={ORG_ID} workflowId={WORKFLOW_ID} />);
    expect(await screen.findByText(/Se programa al activar una versión/)).toBeDefined();
  });
});

describe('credentials and allowlist', () => {
  const credential = {
    id: '0192f0a0-0000-7000-8000-0000000000f1',
    name: 'API de pedidos',
    kind: 'bearer',
    headerName: null,
    createdAt: WHEN,
    createdBy: { id: '0192f0a0-0000-7000-8000-000000000001', name: 'Ana' },
    rotatedAt: null,
  };
  const host = {
    id: '0192f0a0-0000-7000-8000-0000000000f2',
    pattern: 'api.example.com',
    createdAt: WHEN,
  };

  it('creates a credential and clears the secret: it is never shown again', async () => {
    let created = false;
    const fetchMock = stubApi(
      sessionAs('owner'),
      whenPath(/\/credentials$/, 'GET', () => json({ items: created ? [credential] : [] })),
      whenPath(/\/credentials$/, 'POST', () => {
        created = true;
        return json(credential, 201);
      }),
      whenPath(/\/http-allowed-hosts$/, 'GET', () => json({ items: [] })),
    );
    renderWithClient(<ConnectionsPage organizationId={ORG_ID} />);

    await userEvent.type(await screen.findByLabelText('Nombre'), 'API de pedidos');
    const secretInput = screen.getByLabelText<HTMLInputElement>('Secreto');
    expect(secretInput.type).toBe('password');
    await userEvent.type(secretInput, SECRET);
    await userEvent.click(screen.getByRole('button', { name: 'Crear credencial' }));

    expect(await screen.findByText('API de pedidos', { selector: 'td' })).toBeDefined();
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>('Secreto').value).toBe(''));
    expect(document.body.textContent).not.toContain(SECRET);
    const post = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/credentials') && init?.method === 'POST',
    );
    expect(JSON.parse(bodyText(post![1]))).toMatchObject({ kind: 'bearer', secret: SECRET });
  });

  it('rotates with a new secret and never displays the old one', async () => {
    const fetchMock = stubApi(
      sessionAs('owner'),
      whenPath(/\/credentials$/, 'GET', () => json({ items: [credential] })),
      whenPath(/\/credentials\/[^/]+$/, 'PUT', () => json({ ...credential, rotatedAt: WHEN })),
      whenPath(/\/http-allowed-hosts$/, 'GET', () => json({ items: [] })),
    );
    renderWithClient(<ConnectionsPage organizationId={ORG_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Rotar API de pedidos' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Secreto nuevo'), SECRET);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rotar' }));
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
      expect(JSON.parse(bodyText(put![1]))).toEqual({ secret: SECRET });
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it('shows an editor the metadata and the allowlist without any control to change them', async () => {
    stubApi(
      sessionAs('editor'),
      whenPath(/\/credentials$/, 'GET', () => json({ items: [credential] })),
      whenPath(/\/http-allowed-hosts$/, 'GET', () => json({ items: [host] })),
    );
    renderWithClient(<ConnectionsPage organizationId={ORG_ID} />);
    expect(await screen.findByText('API de pedidos', { selector: 'td' })).toBeDefined();
    expect(await screen.findByText('api.example.com')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Crear credencial' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Rotar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Retirar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Agregar' })).toBeNull();
  });

  it('adds and removes allowlist entries as owner, showing the 422 of a bad one', async () => {
    let hosts = [host];
    const fetchMock = stubApi(
      sessionAs('owner'),
      whenPath(/\/credentials$/, 'GET', () => json({ items: [] })),
      whenPath(/\/http-allowed-hosts$/, 'GET', () => json({ items: hosts })),
      whenPath(/\/http-allowed-hosts$/, 'POST', (init) => {
        const { pattern } = JSON.parse(bodyText(init)) as { pattern: string };
        if (pattern === '10.0.0.1')
          return problem(422, 'VALIDATION_FAILED', 'La entrada no es válida.');
        hosts = [...hosts, { ...host, id: '0192f0a0-0000-7000-8000-0000000000f3', pattern }];
        return json(hosts.at(-1), 201);
      }),
      whenPath(/\/http-allowed-hosts\/[^/]+$/, 'DELETE', () => {
        hosts = [];
        return empty();
      }),
    );
    renderWithClient(<ConnectionsPage organizationId={ORG_ID} />);
    const input = await screen.findByLabelText('Dominio o *.dominio');

    await userEvent.type(input, '10.0.0.1');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));
    expect(await screen.findByText('La entrada no es válida.')).toBeDefined();

    await userEvent.clear(input);
    await userEvent.type(input, '*.partner.com');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));
    expect(await screen.findByText('*.partner.com')).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: 'Retirar api.example.com' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true),
    );
  });

  it('tells a viewer the connections are not for their role', async () => {
    stubApi(sessionAs('viewer'));
    renderWithClient(<ConnectionsPage organizationId={ORG_ID} />);
    expect(await screen.findByText('Tu rol no permite ver las conexiones.')).toBeDefined();
  });
});

describe('palette and run origin (US10)', () => {
  const labelsOfF7 = () =>
    screen.getAllByText(/Ejecutable|Se ejecuta desde F7/).map((node) => node.textContent);

  it('marks the F7 nodes as executable', () => {
    render(<Palette onAdd={() => undefined} />);
    expect(screen.getByText('Disparador por webhook')).toBeDefined();
    expect(labelsOfF7()).not.toContain('Se ejecuta desde F7');
    expect(screen.getAllByText('Ejecutable').length).toBeGreaterThanOrEqual(4);
  });

  it('names who or what started a run', () => {
    const base = { triggeredBy: null, trigger: { kind: 'manual' as const } };
    expect(originOf({ ...base, triggeredBy: { name: 'Ana' } })).toBe('Ana');
    expect(originOf({ ...base, trigger: { kind: 'webhook' } })).toBe('Webhook');
    expect(originOf({ ...base, trigger: { kind: 'schedule' } })).toBe('Programación');
    expect(originOf(base)).toBe('Sistema');
  });
});
