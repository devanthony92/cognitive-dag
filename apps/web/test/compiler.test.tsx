import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PROBLEM_CONTENT_TYPE,
  type Compilation,
  type CompilationResult,
  type Role,
  type SessionInfo,
} from '@cognitive-dag/contracts';
import './flow-polyfills';
import { routeTree } from '../src/routeTree.gen';
import { FakeServer, mountEditor } from './editor-harness';

// The real wait grows from 1 s to 5 s: tests poll fast.
vi.mock('../src/features/compiler/poll', () => ({ pollDelay: () => 15 }));

const ORG_ID = '0192f0a0-0000-7000-8000-0000000000aa';
const WORKFLOW_ID = '0192f0a0-0000-7000-8000-0000000000f1';
const NEW_WORKFLOW_ID = '0192f0a0-0000-7000-8000-0000000000f2';
const COMPILATION_ID = '0192f0a0-0000-7000-8000-0000000000c1';
const USER_ID = '0192f0a0-0000-7000-8000-000000000001';
const CORRELATION_ID = '0b5f7f5e-3c1a-4d57-9a53-7d9a2a2d6c11';
const NOW = '2026-11-06T12:00:00.000Z';

const FLAGS: Record<string, boolean> = {};

const session = (role: Role): SessionInfo => ({
  user: { id: USER_ID, name: 'Ana', email: 'ana@example.com' },
  organizations: [{ id: ORG_ID, name: 'Equipo', role, isPersonal: false }],
  csrfToken: 'c'.repeat(43),
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const problem = (status: number, code: string, detail = 'Detalle.', extra = {}) =>
  new Response(
    JSON.stringify({
      status,
      title: 'Error',
      detail,
      code,
      correlationId: CORRELATION_ID,
      ...extra,
    }),
    { status, headers: { 'Content-Type': PROBLEM_CONTENT_TYPE } },
  );

const compilation = (overrides: Partial<Compilation> = {}): Compilation => ({
  id: COMPILATION_ID,
  workflowId: null,
  mode: 'create',
  baseDraftRevision: null,
  status: 'queued',
  model: 'gemini-test',
  calls: 0,
  repairs: 0,
  tokensUsed: 0,
  costMicroUsd: 0,
  nodeCount: null,
  hasFallback: false,
  errorClass: null,
  errorCode: null,
  requestedBy: USER_ID,
  createdAt: NOW,
  finishedAt: null,
  ...overrides,
});

const DONE = {
  status: 'succeeded' as const,
  calls: 2,
  repairs: 1,
  tokensUsed: 1500,
  costMicroUsd: 420,
  nodeCount: 3,
  finishedAt: NOW,
};

const DEFINITION = {
  schemaVersion: 1,
  nodes: [
    {
      id: 'inicio',
      type: 'trigger.manual',
      label: 'Recibir correo',
      position: { x: 0, y: 0 },
      config: { inputSchema: [] },
    },
    {
      id: 'archivar',
      type: 'mock.service',
      label: 'Archivar spam',
      position: { x: 240, y: 0 },
      config: { latencyMs: 100, failureRate: 0, failureKind: 'transient' },
    },
  ],
  edges: [{ id: 'inicio-out-archivar', source: 'inicio', sourceHandle: 'out', target: 'archivar' }],
};

const result = (overrides: Partial<CompilationResult> = {}): CompilationResult => ({
  kind: 'result',
  title: 'Clasificar correos',
  definition: DEFINITION,
  validation: { valid: true, errors: [] },
  omittedSensitiveFields: [],
  ...overrides,
});

/** What the API holds: the compilations, the statuses a poll goes through and the workflows. */
class FakeApi {
  features: Record<string, boolean> = FLAGS;
  list: Compilation[] = [];
  listResponse: (() => Response) | undefined;
  /** Each read of the compilation answers the next one; the last repeats. */
  reads: Compilation[] = [compilation()];
  resultResponse: () => Response = () => json(result());
  postResponse: (() => Response) | undefined;
  putResponse: () => Response = () =>
    json({ revision: 2, validation: { valid: true, errors: [] } });
  createWorkflowResponse: () => Response = () =>
    json(
      {
        id: NEW_WORKFLOW_ID,
        name: 'Clasificar correos',
        draftRevision: 1,
        draftUpdatedAt: NOW,
        activeVersionNumber: null,
        draft: { schemaVersion: 1, nodes: [], edges: [] },
      },
      201,
    );
  posted: unknown[] = [];
  puts: Array<{ url: string; ifMatch: string | null; body: { definition: unknown } }> = [];
  createdNames: string[] = [];
  private read = 0;

  handle =
    (role: Role) =>
    (url: string, init: RequestInit = {}): Promise<Response> => {
      const method = init.method ?? 'GET';
      if (url.endsWith('/features')) return Promise.resolve(json(this.features));
      if (url.endsWith('/auth/session')) return Promise.resolve(json(session(role)));
      if (/\/compilations(\?.*)?$/.test(url) && method === 'GET') {
        return Promise.resolve(
          this.listResponse ? this.listResponse() : json({ items: this.list }),
        );
      }
      if (/\/compilations$/.test(url) && method === 'POST') {
        this.posted.push(JSON.parse(init.body as string));
        return Promise.resolve(this.postResponse ? this.postResponse() : json(this.reads[0], 202));
      }
      if (/\/compilations\/[0-9a-f-]{36}\/result$/.test(url)) {
        return Promise.resolve(this.resultResponse());
      }
      if (/\/compilations\/[0-9a-f-]{36}$/.test(url)) {
        const index = Math.min(this.read, this.reads.length - 1);
        this.read += 1;
        return Promise.resolve(json(this.reads[index]));
      }
      if (/\/workflows$/.test(url) && method === 'GET') {
        return Promise.resolve(
          json([
            {
              id: WORKFLOW_ID,
              name: 'Soporte técnico',
              draftRevision: 4,
              draftUpdatedAt: NOW,
              activeVersionNumber: null,
            },
          ]),
        );
      }
      if (/\/workflows$/.test(url) && method === 'POST') {
        this.createdNames.push((JSON.parse(init.body as string) as { name: string }).name);
        return Promise.resolve(this.createWorkflowResponse());
      }
      if (/\/draft$/.test(url) && method === 'PUT') {
        const headers = new Headers(init.headers);
        this.puts.push({
          url,
          ifMatch: headers.get('If-Match'),
          body: JSON.parse(init.body as string) as { definition: unknown },
        });
        return Promise.resolve(this.putResponse());
      }
      if (/\/workflows\/[0-9a-f-]{36}$/.test(url) && method === 'GET') {
        return Promise.resolve(
          json({
            id: url.split('/').pop(),
            name: 'Editor abierto',
            draftRevision: 2,
            draftUpdatedAt: NOW,
            activeVersionNumber: null,
            draft: { schemaVersion: 1, nodes: [], edges: [] },
          }),
        );
      }
      if (/\/(versions|limits)$/.test(url)) {
        return Promise.resolve(
          url.endsWith('/limits')
            ? json({ maxNodes: 50, maxEdges: 100, maxDefinitionBytes: 262144, source: 'default' })
            : json([]),
        );
      }
      return Promise.resolve(problem(404, 'NOT_FOUND'));
    };
}

function open(path: string, api: FakeApi, role: Role = 'editor') {
  const fetchMock = vi.fn(api.handle(role));
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

const NEW_PATH = `/orgs/${ORG_ID}/workflows/new`;
const REGENERATE_PATH = `${NEW_PATH}?workflowId=${WORKFLOW_ID}`;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function describeAndSend(user: ReturnType<typeof userEvent.setup>, text: string) {
  const box = await screen.findByLabelText('Describe qué quieres automatizar');
  await user.click(box);
  await user.paste(text);
  await user.click(screen.getByRole('button', { name: 'Generar borrador' }));
}

describe('entry points (US1, US2)', () => {
  it('offers "Describir workflow" to editors', async () => {
    const { router } = open(`/orgs/${ORG_ID}/workflows`, new FakeApi());
    const link = await screen.findByRole('link', { name: /Describir workflow/ });
    expect(link.getAttribute('href')).toBe(NEW_PATH);
    expect(router.state.location.pathname).toBe(`/orgs/${ORG_ID}/workflows`);
  });

  it('hides it from viewers', async () => {
    open(`/orgs/${ORG_ID}/workflows`, new FakeApi(), 'viewer');
    await screen.findByText('Tus workflows');
    expect(screen.queryByRole('link', { name: /Describir workflow/ })).toBeNull();
  });

  it('adds "Regenerar borrador" to the editor for writers only', async () => {
    const server = new FakeServer({ schemaVersion: 1, nodes: [], edges: [] });
    mountEditor(server);
    const link = await screen.findByRole('link', { name: /Regenerar borrador/ });
    expect(link.getAttribute('href')).toContain(`/workflows/new?workflowId=`);
    cleanup();
    vi.unstubAllGlobals();

    const viewerServer = new FakeServer({ schemaVersion: 1, nodes: [], edges: [] });
    mountEditor(viewerServer, 'viewer');
    await screen.findByText('Solo lectura');
    expect(screen.queryByRole('link', { name: /Regenerar borrador/ })).toBeNull();
  });
});

describe('intent form (US1)', () => {
  it('counts the characters and blocks the send above 2000', async () => {
    const { user } = open(NEW_PATH, new FakeApi());
    const box = await screen.findByLabelText('Describe qué quieres automatizar');
    const send = screen.getByRole('button', { name: 'Generar borrador' });
    expect(screen.getByText('0 / 2000')).toBeTruthy();
    expect(send).toHaveProperty('disabled', true);

    await user.click(box);
    await user.paste('hola');
    expect(screen.getByText('4 / 2000')).toBeTruthy();
    expect(send).toHaveProperty('disabled', false);

    await user.clear(box);
    await user.paste('a'.repeat(2001));
    expect(screen.getByText('2001 / 2000')).toBeTruthy();
    expect(screen.getByText('Máximo 2000 caracteres.')).toBeTruthy();
    expect(send).toHaveProperty('disabled', true);
  });

  it('does not accept an intent of spaces only', async () => {
    const { user } = open(NEW_PATH, new FakeApi());
    const box = await screen.findByLabelText('Describe qué quieres automatizar');
    await user.click(box);
    await user.paste('    ');
    expect(screen.getByRole('button', { name: 'Generar borrador' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('sends the trimmed intent, with the workflow when regenerating', async () => {
    const api = new FakeApi();
    const { user } = open(REGENERATE_PATH, api);
    await describeAndSend(user, '  clasifica correos  ');
    await waitFor(() => expect(api.posted).toHaveLength(1));
    expect(api.posted[0]).toEqual({ intent: 'clasifica correos', workflowId: WORKFLOW_ID });
  });

  it('shows the wait when the person is rate limited', async () => {
    const api = new FakeApi();
    api.postResponse = () =>
      problem(429, 'COMPILER_RATE_LIMITED', 'Llegaste al máximo de 10 compilaciones por hora.', {
        retryAfterSeconds: 90,
      });
    const { user } = open(NEW_PATH, api);
    await describeAndSend(user, 'algo');
    expect(await screen.findByText(/máximo de 10 compilaciones por hora/)).toBeTruthy();
    expect(screen.getByText(/Vuelve a intentarlo en 2 minutos/)).toBeTruthy();
  });

  it('keeps the text after an error so it can be sent again', async () => {
    const api = new FakeApi();
    api.postResponse = () => problem(503, 'SERVICE_UNAVAILABLE', 'Sin servicio.');
    const { user } = open(NEW_PATH, api);
    await describeAndSend(user, 'mi texto');
    await screen.findByText('Sin servicio.');
    expect(
      screen.getByLabelText<HTMLTextAreaElement>('Describe qué quieres automatizar').value,
    ).toBe('mi texto');
  });
});

describe('states and preview (US1)', () => {
  it('follows the compilation by polling and then shows the preview, metrics and notice', async () => {
    const api = new FakeApi();
    api.reads = [
      compilation(),
      compilation({ status: 'running' }),
      compilation({ status: 'running' }),
      compilation(DONE),
    ];
    const { user } = open(NEW_PATH, api);
    await describeAndSend(user, 'clasifica correos');

    await screen.findByRole('status', { name: 'Estado: En cola' });
    await screen.findByRole('status', { name: 'Estado: Compilando' });
    await screen.findByRole('status', { name: 'Estado: Listo' });

    // Read-only React Flow preview with the nodes of the result.
    expect(await screen.findByText('Recibir correo')).toBeTruthy();
    expect(screen.getByText('Archivar spam')).toBeTruthy();
    expect(screen.getByLabelText('Vista previa del workflow generado')).toBeTruthy();

    const metrics = within(screen.getByLabelText('Métricas de la compilación'));
    expect(metrics.getByText('gemini-test')).toBeTruthy();
    expect(metrics.getByText('Llamadas').nextSibling?.textContent).toBe('2');
    expect(metrics.getByText('Reparaciones').nextSibling?.textContent).toBe('1');
    expect(metrics.getByText('Tokens').nextSibling?.textContent).toBe('1500');
    expect(metrics.getByText('Costo estimado').nextSibling?.textContent).toMatch(/0,00042/);

    expect(screen.getByText(/capa gratuita de Gemini/)).toBeTruthy();
  });

  it('lists the sensitive fields the compiler left out', async () => {
    const api = new FakeApi();
    api.reads = [compilation(DONE)];
    api.resultResponse = () =>
      json(
        result({
          omittedSensitiveFields: [{ nodeId: 'archivar', field: 'config.url' }],
          validation: {
            valid: false,
            errors: [
              {
                code: 'CONFIG_REQUIRED',
                message: 'Falta la URL.',
                location: { node: 'archivar', field: 'config.url' },
              },
            ],
          },
        }),
      );
    const { user } = open(NEW_PATH, api);
    await describeAndSend(user, 'avisa por http');
    expect(await screen.findByText('Campos sensibles que debes completar tú:')).toBeTruthy();
    expect(screen.getByText('config.url')).toBeTruthy();
    const errors = within(await screen.findByLabelText('Errores de validación'));
    expect(errors.getByText(/Falta la URL\./)).toBeTruthy();
  });

  it('says so when the result expired and offers to compile again', async () => {
    const api = new FakeApi();
    api.reads = [compilation(DONE)];
    api.resultResponse = () => problem(410, 'COMPILER_RESULT_EXPIRED', 'Venció.');
    const { user } = open(NEW_PATH, api);
    await describeAndSend(user, 'algo');
    expect(await screen.findByText(/El resultado expiró/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Volver a compilar' }));
    expect(screen.queryByRole('status', { name: 'Estado: Listo' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Generar borrador' })).toBeTruthy();
  });

  it('shows a failure without a last attempt and lets the person try again', async () => {
    const api = new FakeApi();
    api.reads = [
      compilation({
        status: 'failed',
        errorClass: 'invalid_output',
        errorCode: 'COMPILER_INVALID_DAG',
        calls: 3,
        repairs: 2,
        finishedAt: NOW,
      }),
    ];
    const { user } = open(NEW_PATH, api);
    await describeAndSend(user, 'algo imposible');
    expect(await screen.findByText(/no logró un workflow válido/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Abrir el último intento/ })).toBeNull();
    expect(screen.queryByLabelText('Vista previa del workflow generado')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Intentar de nuevo' }));
    expect(screen.queryByText(/no logró un workflow válido/)).toBeNull();
  });
});

describe('create a workflow with the draft (US1)', () => {
  const finished = () => {
    const api = new FakeApi();
    api.reads = [compilation(DONE)];
    return api;
  };

  it('creates the workflow, saves the draft at revision 1 and opens the editor', async () => {
    const api = finished();
    const { user, router } = open(NEW_PATH, api);
    await describeAndSend(user, 'clasifica correos');

    const name = await screen.findByLabelText('Nombre del workflow nuevo');
    expect((name as HTMLInputElement).value).toBe('Clasificar correos');
    await user.clear(name);
    await user.type(name, 'Mi flujo');
    await user.click(screen.getByRole('button', { name: 'Crear workflow con este borrador' }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/orgs/${ORG_ID}/workflows/${NEW_WORKFLOW_ID}`),
    );
    expect(api.createdNames).toEqual(['Mi flujo']);
    expect(api.puts).toHaveLength(1);
    expect(api.puts[0]?.url).toContain(`/workflows/${NEW_WORKFLOW_ID}/draft`);
    expect(api.puts[0]?.ifMatch).toBe('"1"');
    expect(api.puts[0]?.body.definition).toEqual(DEFINITION);
  });

  it('does not create a second workflow when only saving the draft failed', async () => {
    const api = finished();
    api.putResponse = () => problem(503, 'SERVICE_UNAVAILABLE', 'Sin servicio.');
    const { user, router } = open(NEW_PATH, api);
    await describeAndSend(user, 'clasifica correos');
    await user.click(
      await screen.findByRole('button', { name: 'Crear workflow con este borrador' }),
    );

    expect(await screen.findByText(/se creó, pero no se pudo guardar el borrador/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'abrirlo vacío' })).toBeTruthy();

    api.putResponse = () => json({ revision: 2, validation: { valid: true, errors: [] } });
    await user.click(screen.getByRole('button', { name: 'Reintentar el guardado' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/orgs/${ORG_ID}/workflows/${NEW_WORKFLOW_ID}`),
    );
    expect(api.createdNames).toHaveLength(1);
    expect(api.puts).toHaveLength(2);
  });

  it('shows the error when the name is taken and creates nothing else', async () => {
    const api = finished();
    api.createWorkflowResponse = () =>
      problem(409, 'WORKFLOW_NAME_TAKEN', 'Ya existe un workflow con ese nombre.');
    const { user } = open(NEW_PATH, api);
    await describeAndSend(user, 'clasifica correos');
    await user.click(
      await screen.findByRole('button', { name: 'Crear workflow con este borrador' }),
    );
    expect(await screen.findByText('Ya existe un workflow con ese nombre.')).toBeTruthy();
    expect(api.puts).toHaveLength(0);
  });

  it('asks for a name before creating', async () => {
    const { user } = open(NEW_PATH, finished());
    await describeAndSend(user, 'clasifica correos');
    const name = await screen.findByLabelText('Nombre del workflow nuevo');
    await user.clear(name);
    expect(screen.getByRole('button', { name: 'Crear workflow con este borrador' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('does not offer to apply to a viewer', async () => {
    const api = finished();
    api.list = [compilation(DONE)];
    const { user } = open(NEW_PATH, api, 'viewer');
    await screen.findByText(/Tu rol no permite compilar/);
    await user.click(await screen.findByRole('button', { name: 'Ver' }));
    expect(
      await screen.findByText('Tu rol no permite crear ni reemplazar borradores.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Crear workflow con este borrador' })).toBeNull();
  });
});

describe('regenerate the draft (US2)', () => {
  const regenerated = (overrides: Partial<Compilation> = {}) =>
    compilation({
      ...DONE,
      mode: 'regenerate',
      workflowId: WORKFLOW_ID,
      baseDraftRevision: 4,
      ...overrides,
    });

  it('asks to confirm, then replaces the draft at the revision it was asked from', async () => {
    const api = new FakeApi();
    api.reads = [regenerated()];
    const { user, router } = open(REGENERATE_PATH, api);
    expect(await screen.findByText(/para «Soporte técnico»/)).toBeTruthy();
    await describeAndSend(user, 'otra idea');

    await user.click(await screen.findByRole('button', { name: 'Reemplazar borrador' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('¿Reemplazar el borrador?')).toBeTruthy();
    expect(api.puts).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Reemplazar' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/orgs/${ORG_ID}/workflows/${WORKFLOW_ID}`),
    );
    expect(api.puts).toHaveLength(1);
    expect(api.puts[0]?.url).toContain(`/workflows/${WORKFLOW_ID}/draft`);
    expect(api.puts[0]?.ifMatch).toBe('"4"');
    expect(api.createdNames).toEqual([]);
  });

  it('cancels without writing anything', async () => {
    const api = new FakeApi();
    api.reads = [regenerated()];
    const { user } = open(REGENERATE_PATH, api);
    await describeAndSend(user, 'otra idea');
    await user.click(await screen.findByRole('button', { name: 'Reemplazar borrador' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }),
    );
    expect(api.puts).toHaveLength(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('explains the revision conflict and leaves the draft alone', async () => {
    const api = new FakeApi();
    api.reads = [regenerated()];
    api.putResponse = () => problem(409, 'DRAFT_CONFLICT', 'El borrador cambió.');
    const { user, router } = open(REGENERATE_PATH, api);
    await describeAndSend(user, 'otra idea');
    await user.click(await screen.findByRole('button', { name: 'Reemplazar borrador' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Reemplazar' }));

    expect(
      await within(dialog).findByText('El borrador cambió desde que pediste la compilación.'),
    ).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Abrir el editor' })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Reemplazar' })).toBeNull();
    expect(router.state.location.pathname).toBe(NEW_PATH);
  });

  it('lists only the compilations of that workflow', async () => {
    const api = new FakeApi();
    const { fetchMock } = open(REGENERATE_PATH, api);
    await screen.findByText('Compilaciones recientes');
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).endsWith(`/compilations?workflowId=${WORKFLOW_ID}`),
        ),
      ).toBe(true),
    );
  });
});

describe('last attempt of a failed compilation (US3)', () => {
  it('opens the last attempt as a draft, with its validation errors', async () => {
    const api = new FakeApi();
    api.reads = [
      compilation({
        status: 'failed',
        errorClass: 'invalid_output',
        errorCode: 'COMPILER_INVALID_DAG',
        hasFallback: true,
        nodeCount: 2,
        calls: 3,
        repairs: 2,
        finishedAt: NOW,
      }),
    ];
    api.resultResponse = () =>
      json(
        result({
          kind: 'fallback',
          validation: {
            valid: false,
            errors: [
              {
                code: 'CYCLE',
                message: 'El flujo tiene un ciclo.',
                location: { nodes: ['inicio', 'archivar'] },
              },
            ],
          },
        }),
      );
    const { user, router } = open(NEW_PATH, api);
    await describeAndSend(user, 'algo difícil');

    expect(await screen.findByText(/La compilación falló/)).toBeTruthy();
    expect(await screen.findByText(/El flujo tiene un ciclo\./)).toBeTruthy();
    expect(screen.getByLabelText('Vista previa del workflow generado')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Abrir el último intento como borrador' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/orgs/${ORG_ID}/workflows/${NEW_WORKFLOW_ID}`),
    );
    expect(api.puts[0]?.body.definition).toEqual(DEFINITION);
  });
});

describe('recent compilations', () => {
  it('shows the loading, empty and error states', async () => {
    const empty = new FakeApi();
    open(NEW_PATH, empty);
    expect(await screen.findByText('Cargando compilaciones…')).toBeTruthy();
    expect(await screen.findByText('Todavía no hay compilaciones.')).toBeTruthy();
    cleanup();

    const broken = new FakeApi();
    broken.listResponse = () => problem(503, 'SERVICE_UNAVAILABLE', 'Lista caída.');
    open(NEW_PATH, broken);
    expect(await screen.findByText('Lista caída.')).toBeTruthy();
  });

  it('lists them and opens one, even if it was started on another visit', async () => {
    const api = new FakeApi();
    api.list = [
      compilation({ id: '0192f0a0-0000-7000-8000-0000000000c9', ...DONE }),
      compilation({
        id: '0192f0a0-0000-7000-8000-0000000000c8',
        status: 'failed',
        errorCode: 'LLM_CONTENT_BLOCKED',
        errorClass: 'permanent',
        finishedAt: NOW,
      }),
    ];
    api.reads = [compilation({ id: '0192f0a0-0000-7000-8000-0000000000c9', ...DONE })];
    const { user } = open(NEW_PATH, api);
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Listo')).toBeTruthy();
    expect(within(table).getByText('Falló')).toBeTruthy();

    await user.click(within(table).getAllByRole('button', { name: 'Ver' })[0]!);
    expect(await screen.findByText('Recibir correo')).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Estado: Listo' })).toBeTruthy();
  });
});
