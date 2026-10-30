import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROBLEM_CONTENT_TYPE, type Role, type SessionInfo } from '@cognitive-dag/contracts';
import { NODE_CATALOG, NODE_TYPES } from '@cognitive-dag/dag-schema';
import './flow-polyfills';
import { WorkflowEditor } from '../src/features/workflows/WorkflowEditor';

const ORG_ID = '0192f0a0-0000-7000-8000-0000000000aa';
const WORKFLOW_ID = '0192f0a0-0000-7000-8000-0000000000f1';
const CORRELATION_ID = '0b5f7f5e-3c1a-4d57-9a53-7d9a2a2d6c11';
const NOW = '2026-10-30T12:00:00.000Z';

const session = (role: Role): SessionInfo => ({
  user: { id: '0192f0a0-0000-7000-8000-000000000001', name: 'Ana', email: 'ana@example.com' },
  organizations: [{ id: ORG_ID, name: 'Equipo', role, isPersonal: false }],
  csrfToken: 'c'.repeat(43),
});

const node = (id: string, type: string, label: string, config: unknown, x = 0) => ({
  id,
  type,
  label,
  position: { x, y: 0 },
  config,
});

const VALID_DRAFT = {
  schemaVersion: 1,
  nodes: [
    node('manual_1', 'trigger.manual', 'Disparo', { inputSchema: [] }),
    node(
      'generate_1',
      'llm.generate',
      'Resumir',
      { instruction: 'Escribe un resumen.', language: 'es', maxLength: 1000 },
      300,
    ),
  ],
  edges: [{ id: 'e1', source: 'manual_1', sourceHandle: 'out', target: 'generate_1' }],
};

// No trigger at all.
const INVALID_DRAFT = {
  schemaVersion: 1,
  nodes: [VALID_DRAFT.nodes[1]],
  edges: [],
};

// A trigger, and a node nobody connected to it.
const ORPHAN_DRAFT = { ...VALID_DRAFT, edges: [] };

const workflow = (
  draft: unknown,
  draftRevision = 3,
  activeVersionNumber: number | null = null,
) => ({
  id: WORKFLOW_ID,
  name: 'Soporte',
  draftRevision,
  draftUpdatedAt: NOW,
  activeVersionNumber,
  draft,
});

const version = (number: number, active: boolean, note: string | null = null) => ({
  number,
  note,
  publishedAt: '2026-10-29T10:30:00.000Z',
  publishedBy: { id: '0192f0a0-0000-7000-8000-000000000001', name: 'Ana' },
  nodeCount: 2,
  edgeCount: 1,
  nodeTypes: ['trigger.manual', 'llm.generate'],
  active,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const problem = (status: number, code: string, detail = 'Detalle del error.') =>
  new Response(
    JSON.stringify({ status, title: 'Error', detail, code, correlationId: CORRELATION_ID }),
    { status, headers: { 'Content-Type': PROBLEM_CONTENT_TYPE } },
  );

type Handler = (url: string, init: RequestInit) => Response | undefined;
const whenPath =
  (suffix: RegExp, method: string, respond: (init: RequestInit) => Response): Handler =>
  (url, init) =>
    suffix.test(url) && (init.method ?? 'GET') === method ? respond(init) : undefined;

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

interface Options {
  role?: Role;
  draft?: unknown;
  revision?: number;
  versions?: ReturnType<typeof version>[];
  extra?: Handler[];
}

function setup({
  role = 'editor',
  draft = VALID_DRAFT,
  revision = 3,
  versions = [],
  extra = [],
}: Options = {}) {
  const fetchMock = stubApi(
    ...extra,
    whenPath(/\/auth\/session$/, 'GET', () => json(session(role))),
    whenPath(/\/limits$/, 'GET', () =>
      json({ maxNodes: 50, maxEdges: 100, maxDefinitionBytes: 262144, source: 'default' }),
    ),
    whenPath(/\/versions$/, 'GET', () => json(versions)),
    whenPath(/\/workflows\/[0-9a-f-]{36}$/, 'GET', () => json(workflow(draft, revision))),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute();
  const editor = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <WorkflowEditor organizationId={ORG_ID} workflowId={WORKFLOW_ID} />,
  });
  const elsewhere = createRoute({
    getParentRoute: () => root,
    path: '/otra',
    component: () => <p>Otra página</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([editor, elsewhere]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { fetchMock, router, user: userEvent.setup() };
}

const calls = (fetchMock: ReturnType<typeof stubApi>, method: string, pattern: RegExp) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => pattern.test(url) && (init?.method ?? 'GET') === method,
  );

const palette = () => screen.getByRole('complementary', { name: 'Paleta de nodos' });
const panel = () => screen.getByRole('complementary', { name: 'Panel lateral' });
const handleIds = (element: Element, kind: 'source' | 'target') =>
  [...element.querySelectorAll(`.${kind}`)].map((handle) => handle.getAttribute('data-handleid'));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('editor: palette and canvas (US1)', () => {
  it('offers the 11 node types, grouped, saying which phase runs each', async () => {
    setup();
    await screen.findByText('Resumir');

    for (const type of NODE_TYPES) {
      const entry = NODE_CATALOG[type];
      expect(
        within(palette()).getByRole('button', { name: new RegExp(entry.label) }),
      ).toBeDefined();
    }
    expect(within(palette()).getAllByRole('button')).toHaveLength(11);
    expect(within(palette()).getAllByText('Se ejecuta desde F3').length).toBeGreaterThan(0);
    expect(within(palette()).getAllByText('Se ejecuta desde F5').length).toBeGreaterThan(0);
    expect(within(palette()).getAllByText('Se ejecuta desde F7').length).toBeGreaterThan(0);
    expect(within(palette()).getByRole('heading', { name: 'Disparadores' })).toBeDefined();
  });

  it('renders the saved nodes and adds a node, opening its panel, from the palette', async () => {
    const { user } = setup();
    expect(await screen.findByText('Disparo')).toBeDefined();
    expect(screen.getByText('Resumir')).toBeDefined();

    await user.click(within(palette()).getByRole('button', { name: /Clasificar/ }));

    expect(await within(panel()).findByText('classify_1')).toBeDefined();
    expect(document.querySelector('[data-id="classify_1"]')).not.toBeNull();
    expect(screen.getByText(/Sin guardar/)).toBeDefined();
  });

  it('draws the handles of the catalog on each node', async () => {
    const { user } = setup({ draft: { schemaVersion: 1, nodes: [], edges: [] } });
    await screen.findByRole('button', { name: 'Guardar' });

    await user.click(within(palette()).getByRole('button', { name: /Condición/ }));
    await user.click(within(palette()).getByRole('button', { name: /Aprobación humana/ }));
    await user.click(within(palette()).getByRole('button', { name: /Disparador manual/ }));

    const condition = document.querySelector('[data-id="condition_1"]')!;
    expect(handleIds(condition, 'source')).toEqual(['true', 'false']);
    const approval = document.querySelector('[data-id="approval_1"]')!;
    expect(handleIds(approval, 'source')).toEqual(['approved', 'rejected', 'timeout']);
    expect(handleIds(approval, 'target')).toHaveLength(1);
    // A trigger starts the flow: it can send but never receive.
    const trigger = document.querySelector('[data-id="manual_1"]')!;
    expect(handleIds(trigger, 'target')).toHaveLength(0);
  });

  it('builds the side panel form from the configSchema of the selected node', async () => {
    setup();
    fireEvent.click(await screen.findByText('Resumir'));

    expect(await within(panel()).findByLabelText('Instrucción')).toHaveProperty(
      'value',
      'Escribe un resumen.',
    );
    expect(within(panel()).getByLabelText('Idioma')).toHaveProperty('value', 'es');
    expect(within(panel()).getByLabelText('Longitud máxima')).toHaveProperty('value', '1000');

    fireEvent.click(screen.getByText('Disparo'));
    expect(await within(panel()).findByLabelText('Campos de entrada')).toBeDefined();
    expect(within(panel()).queryByLabelText('Instrucción')).toBeNull();
  });

  it('writes the edit into the node and the canvas follows the label', async () => {
    const { user } = setup();
    fireEvent.click(await screen.findByText('Resumir'));
    const label = await within(panel()).findByLabelText('Nombre del nodo');
    await user.clear(label);
    await user.type(label, 'Resumen corto');

    expect(await screen.findAllByText('Resumen corto')).not.toHaveLength(0);
    expect(screen.getByText(/Sin guardar/)).toBeDefined();
  });

  it('saves with If-Match and shows when it was saved', async () => {
    const { user, fetchMock } = setup({
      extra: [
        whenPath(/\/draft$/, 'PUT', () =>
          json({ revision: 4, validation: { valid: true, errors: [] } }),
        ),
      ],
    });
    fireEvent.click(await screen.findByText('Resumir'));
    const instruction = await within(panel()).findByLabelText('Instrucción');
    await user.clear(instruction);
    await user.type(instruction, 'Resume en una línea.');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText(/Guardado a las/)).toBeDefined();
    const [[, init]] = calls(fetchMock, 'PUT', /\/draft$/) as [[string, RequestInit]];
    expect(new Headers(init.headers).get('If-Match')).toBe('"3"');
    const body = JSON.parse(init.body as string) as { definition: typeof VALID_DRAFT };
    expect(body.definition.nodes[1]?.config).toMatchObject({ instruction: 'Resume en una línea.' });
    expect(screen.queryByText(/Sin guardar/)).toBeNull();

    // The next save is based on the revision the server returned.
    await user.type(instruction, '!');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(calls(fetchMock, 'PUT', /\/draft$/)).toHaveLength(2));
    const second = calls(fetchMock, 'PUT', /\/draft$/)[1]![1] as RequestInit;
    expect(new Headers(second.headers).get('If-Match')).toBe('"4"');
  });

  it('asks before leaving with unsaved changes and lets the user stay', async () => {
    const { user, router } = setup();
    fireEvent.click(await screen.findByText('Resumir'));
    await user.type(await within(panel()).findByLabelText('Nombre del nodo'), ' 2');

    void router.navigate({ to: '/otra' as never });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Hay cambios sin guardar')).toBeDefined();
    await user.click(within(dialog).getByRole('button', { name: 'Seguir editando' }));
    expect(screen.queryByText('Otra página')).toBeNull();

    void router.navigate({ to: '/otra' as never });
    const again = await screen.findByRole('dialog');
    await user.click(within(again).getByRole('button', { name: 'Salir sin guardar' }));
    expect(await screen.findByText('Otra página')).toBeDefined();
  });

  it('leaves without asking when there is nothing unsaved', async () => {
    const { router } = setup();
    await screen.findByText('Resumir');
    await router.navigate({ to: '/otra' as never });
    expect(await screen.findByText('Otra página')).toBeDefined();
  });

  it('gives a viewer a read-only canvas: no palette, no save, no publish', async () => {
    setup({ role: 'viewer' });
    fireEvent.click(await screen.findByText('Resumir'));

    expect(screen.queryByRole('complementary', { name: 'Paleta de nodos' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Guardar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publicar' })).toBeNull();
    expect(screen.getByText('Solo lectura')).toBeDefined();
    const instruction = await within(panel()).findByLabelText('Instrucción');
    expect(instruction.matches(':disabled')).toBe(true);
    expect(document.querySelector('.react-flow__node')?.classList.contains('draggable')).toBe(
      false,
    );
  });
});

describe('editor: live validation (US2)', () => {
  it('marks the problems on the nodes and lists them, and blocks publishing', async () => {
    setup({ draft: ORPHAN_DRAFT });

    const problems = await screen.findByRole('region', { name: 'Problemas' });
    expect(within(problems).getAllByRole('listitem')).toHaveLength(1);
    expect(within(problems).getByText(/Resumir/)).toBeDefined();
    expect(
      document.querySelector('[data-id="generate_1"] [data-testid="node-errors"]'),
    ).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Publicar' })).toHaveProperty('disabled', true);
  });

  it('enables publishing when the draft is valid', async () => {
    setup();
    await screen.findByText('Resumir');
    expect(await screen.findByText('Sin problemas')).toBeDefined();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Publicar' })).toHaveProperty('disabled', false),
    );
  });

  it('shows the error under the field after the debounce, and a draft with errors still saves', async () => {
    const { user, fetchMock } = setup({
      extra: [
        whenPath(/\/draft$/, 'PUT', () =>
          json({ revision: 4, validation: { valid: false, errors: [] } }),
        ),
      ],
    });
    fireEvent.click(await screen.findByText('Resumir'));
    const length = await within(panel()).findByLabelText('Longitud máxima');
    await screen.findByText('Sin problemas');
    await user.clear(length);
    await user.type(length, '0');

    // Younger than the 200 ms debounce: the old result still stands.
    expect(screen.queryByText('Sin problemas')).not.toBeNull();
    await waitFor(
      () =>
        expect(within(panel()).getByLabelText('Longitud máxima').getAttribute('aria-invalid')).toBe(
          'true',
        ),
      { timeout: 1500 },
    );
    expect(screen.queryByText('Sin problemas')).toBeNull();
    expect(screen.getByRole('button', { name: 'Publicar' })).toHaveProperty('disabled', true);

    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(calls(fetchMock, 'PUT', /\/draft$/)).toHaveLength(1));
  });

  it('lists a connection that starts from a handle the node does not have', async () => {
    const draft = {
      ...VALID_DRAFT,
      edges: [{ id: 'e1', source: 'manual_1', sourceHandle: 'true', target: 'generate_1' }],
    };
    setup({ draft });

    const problems = await screen.findByRole('region', { name: 'Problemas' });
    expect(within(problems).getAllByRole('listitem').length).toBeGreaterThan(0);
  });

  it('reports invalid JSON in a field', async () => {
    setup();
    fireEvent.click(await screen.findByText('Disparo'));
    const field = await within(panel()).findByLabelText('Campos de entrada');
    fireEvent.change(field, { target: { value: '[{' } });

    expect(await within(panel()).findByText('JSON no válido.')).toBeDefined();
  });
});

describe('editor: versions (US3)', () => {
  it('publishes with an optional note, saving first when there are unsaved changes', async () => {
    const { user, fetchMock } = setup({
      versions: [version(1, false)],
      extra: [
        whenPath(/\/draft$/, 'PUT', () =>
          json({ revision: 4, validation: { valid: true, errors: [] } }),
        ),
        whenPath(/\/versions$/, 'POST', () => json(version(2, true, 'Segunda'), 201)),
      ],
    });
    fireEvent.click(await screen.findByText('Resumir'));
    await user.type(await within(panel()).findByLabelText('Nombre del nodo'), ' 2');
    // Publishing waits for the validation of the latest change.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Publicar' })).toHaveProperty('disabled', false),
    );

    await user.click(screen.getByRole('button', { name: 'Publicar' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nota (opcional)'), 'Segunda');
    await user.click(within(dialog).getByRole('button', { name: 'Publicar versión' }));

    expect(await screen.findByText(/Versión 2 publicada/)).toBeDefined();
    const [[, put]] = calls(fetchMock, 'PUT', /\/draft$/) as [[string, RequestInit]];
    expect(new Headers(put.headers).get('If-Match')).toBe('"3"');
    const [[, post]] = calls(fetchMock, 'POST', /\/versions$/) as [[string, RequestInit]];
    expect(new Headers(post.headers).get('If-Match')).toBe('"4"');
    expect(JSON.parse(post.body as string)).toEqual({ note: 'Segunda' });
  });

  it('lists the history with number, date, publisher, note and the active badge', async () => {
    const { user } = setup({
      versions: [version(2, true, 'Segunda'), version(1, false, 'Primera')],
    });
    await screen.findByText('Resumir');
    await user.click(screen.getByRole('tab', { name: 'Versiones' }));

    const rows = await within(panel()).findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Versión 2')).toBeDefined();
    expect(within(rows[0]!).getByText('Activa')).toBeDefined();
    expect(within(rows[0]!).getByText('Segunda')).toBeDefined();
    expect(within(rows[0]!).getByText(/Ana/)).toBeDefined();
    expect(within(rows[1]!).queryByText('Activa')).toBeNull();
    expect(within(rows[1]!).getByRole('button', { name: 'Activar versión 1' })).toBeDefined();
  });

  it('activates a version without creating a new one', async () => {
    const { user, fetchMock } = setup({
      versions: [version(2, true), version(1, false)],
      extra: [whenPath(/\/versions\/1\/activate$/, 'POST', () => json(version(1, true)))],
    });
    await screen.findByText('Resumir');
    await user.click(screen.getByRole('tab', { name: 'Versiones' }));
    await user.click(await within(panel()).findByRole('button', { name: 'Activar versión 1' }));

    await waitFor(() =>
      expect(calls(fetchMock, 'POST', /\/versions\/1\/activate$/)).toHaveLength(1),
    );
    expect(calls(fetchMock, 'POST', /\/versions$/)).toHaveLength(0);
  });

  it('asks for confirmation before replacing the draft with a version', async () => {
    const { user, fetchMock } = setup({
      versions: [version(1, true)],
      extra: [
        whenPath(/\/draft\/from-version\/1$/, 'POST', () => json(workflow(INVALID_DRAFT, 4))),
      ],
    });
    await screen.findByText('Resumir');
    await user.click(screen.getByRole('tab', { name: 'Versiones' }));
    await user.click(
      await within(panel()).findByRole('button', { name: 'Copiar versión 1 al borrador' }),
    );

    expect(calls(fetchMock, 'POST', /from-version/)).toHaveLength(0);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/reemplazará el borrador/i)).toBeDefined();
    await user.click(within(dialog).getByRole('button', { name: 'Reemplazar borrador' }));

    await waitFor(() => expect(calls(fetchMock, 'POST', /from-version\/1$/)).toHaveLength(1));
    const init = calls(fetchMock, 'POST', /from-version\/1$/)[0]![1] as RequestInit;
    expect(new Headers(init.headers).get('If-Match')).toBe('"3"');
    // The editor now shows the copied draft: the trigger is gone.
    await waitFor(() => expect(document.querySelector('[data-id="manual_1"]')).toBeNull());
  });

  it('offers to reload when the draft changed elsewhere (409)', async () => {
    const { user } = setup({
      versions: [version(1, true)],
      extra: [
        whenPath(/\/draft\/from-version\/1$/, 'POST', () =>
          problem(409, 'DRAFT_CONFLICT', 'El borrador cambió en otra sesión.'),
        ),
      ],
    });
    await screen.findByText('Resumir');
    await user.click(screen.getByRole('tab', { name: 'Versiones' }));
    await user.click(
      await within(panel()).findByRole('button', { name: 'Copiar versión 1 al borrador' }),
    );
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Reemplazar borrador',
      }),
    );

    expect(await screen.findByText(/cambió en otra sesión/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Recargar' })).toBeDefined();
  });

  it('hides activate and copy from viewers', async () => {
    const { user } = setup({ role: 'viewer', versions: [version(1, true), version(2, false)] });
    await screen.findByText('Resumir');
    await user.click(screen.getByRole('tab', { name: 'Versiones' }));

    expect(await within(panel()).findAllByRole('listitem')).toHaveLength(2);
    expect(within(panel()).queryByRole('button', { name: /Activar versión/ })).toBeNull();
    expect(within(panel()).queryByRole('button', { name: /Copiar versión/ })).toBeNull();
  });
});
