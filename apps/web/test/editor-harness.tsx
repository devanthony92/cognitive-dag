import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { PROBLEM_CONTENT_TYPE, type Role, type SessionInfo } from '@cognitive-dag/contracts';
import './flow-polyfills';
import { WorkflowEditor } from '../src/features/workflows/WorkflowEditor';

export const ORG_ID = '0192f0a0-0000-7000-8000-0000000000aa';
export const WORKFLOW_ID = '0192f0a0-0000-7000-8000-0000000000f1';
const CORRELATION_ID = '0b5f7f5e-3c1a-4d57-9a53-7d9a2a2d6c11';
const NOW = '2026-10-30T12:00:00.000Z';

export const session = (role: Role): SessionInfo => ({
  user: { id: '0192f0a0-0000-7000-8000-000000000001', name: 'Ana', email: 'ana@example.com' },
  organizations: [{ id: ORG_ID, name: 'Equipo', role, isPersonal: false }],
  csrfToken: 'c'.repeat(43),
});

export const node = (id: string, type: string, label: string, config: unknown, x = 0, y = 0) => ({
  id,
  type,
  label,
  position: { x, y },
  config,
});

export const edge = (id: string, source: string, target: string, sourceHandle = 'out') => ({
  id,
  source,
  sourceHandle,
  target,
});

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const problem = (status: number, code: string, detail = 'Detalle del error.') =>
  new Response(
    JSON.stringify({ status, title: 'Error', detail, code, correlationId: CORRELATION_ID }),
    { status, headers: { 'Content-Type': PROBLEM_CONTENT_TYPE } },
  );

/** What the API holds for one workflow: the editor talks to this through `fetch`. */
export class FakeServer {
  revision: number;
  draft: unknown;
  saves: Array<{ ifMatch: string | null; definition: unknown }> = [];

  constructor(
    draft: unknown,
    revision = 3,
    private readonly versions: unknown[] = [],
    private readonly versionDefinitions: Record<number, unknown> = {},
    private readonly limits = { maxNodes: 50, maxEdges: 100, maxDefinitionBytes: 262144 },
  ) {
    this.draft = draft;
    this.revision = revision;
  }

  /** Another person saves the draft: the revision moves on under the editor's feet. */
  saveElsewhere(draft: unknown): void {
    this.draft = draft;
    this.revision += 1;
  }

  private workflow() {
    return {
      id: WORKFLOW_ID,
      name: 'Soporte técnico',
      draftRevision: this.revision,
      draftUpdatedAt: NOW,
      activeVersionNumber: null,
      draft: this.draft,
    };
  }

  handle =
    (role: Role) =>
    (url: string, init: RequestInit = {}): Promise<Response> => {
      const method = init.method ?? 'GET';
      if (url.endsWith('/auth/session')) return Promise.resolve(json(session(role)));
      if (url.endsWith('/limits')) {
        return Promise.resolve(json({ ...this.limits, source: 'default' }));
      }
      if (url.endsWith('/versions')) return Promise.resolve(json(this.versions));
      const version = /\/versions\/(\d+)$/.exec(url);
      if (version && method === 'GET') {
        const number = Number(version[1]);
        const summary = (this.versions as Array<{ number: number }>).find(
          (v) => v.number === number,
        );
        return Promise.resolve(
          summary && this.versionDefinitions[number]
            ? json({ ...summary, definition: this.versionDefinitions[number] })
            : problem(404, 'NOT_FOUND'),
        );
      }
      if (/\/draft$/.test(url) && method === 'PUT') {
        const headers = new Headers(init.headers);
        const ifMatch = headers.get('If-Match');
        const body = JSON.parse(init.body as string) as { definition: unknown };
        this.saves.push({ ifMatch, definition: body.definition });
        if (ifMatch !== `"${this.revision}"`) {
          return Promise.resolve(
            problem(409, 'DRAFT_CONFLICT', 'El borrador cambió en otra sesión.'),
          );
        }
        this.draft = body.definition;
        this.revision += 1;
        return Promise.resolve(
          json({ revision: this.revision, validation: { valid: true, errors: [] } }),
        );
      }
      if (/\/workflows\/[0-9a-f-]{36}$/.test(url) && method === 'GET') {
        return Promise.resolve(json(this.workflow()));
      }
      return Promise.resolve(problem(404, 'NOT_FOUND'));
    };
}

export function mountEditor(server: FakeServer, role: Role = 'editor') {
  const fetchMock = vi.fn(server.handle(role));
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute();
  const editor = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <WorkflowEditor organizationId={ORG_ID} workflowId={WORKFLOW_ID} />,
  });
  const router = createRouter({
    routeTree: root.addChildren([editor]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { fetchMock, user: userEvent.setup() };
}
