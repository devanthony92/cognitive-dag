import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import {
  PROBLEM_CONTENT_TYPE,
  type Role,
  type Run,
  type RunStep,
  type SessionInfo,
} from '@cognitive-dag/contracts';
import './flow-polyfills';
import { routeTree } from '../src/routeTree.gen';

export const ORG_ID = '0192f0a0-0000-7000-8000-0000000000aa';
export const WORKFLOW_ID = '0192f0a0-0000-7000-8000-0000000000f1';
export const RUN_ID = '0192f0a0-0000-7000-8000-0000000000b1';
export const NEW_RUN_ID = '0192f0a0-0000-7000-8000-0000000000b2';
const CORRELATION_ID = '0b5f7f5e-3c1a-4d57-9a53-7d9a2a2d6c11';
const NOW = '2026-10-30T12:00:00.000Z';

export const session = (role: Role): SessionInfo => ({
  user: { id: '0192f0a0-0000-7000-8000-000000000001', name: 'Ana', email: 'ana@example.com' },
  organizations: [{ id: ORG_ID, name: 'Equipo', role, isPersonal: false }],
  csrfToken: 'c'.repeat(43),
});

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const problem = (status: number, code: string, detail = 'Detalle.', extra = {}) =>
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

const node = (id: string, type: string, label: string, config: unknown, x: number) => ({
  id,
  type,
  label,
  position: { x, y: 0 },
  config,
});

/** trigger (monto) -> condition -> service A | service B */
export const DEFINITION = {
  schemaVersion: 1,
  nodes: [
    node(
      'inicio',
      'trigger.manual',
      'Inicio',
      { inputSchema: [{ name: 'monto', type: { kind: 'number' } }] },
      0,
    ),
    node('alto', 'logic.condition', '¿Monto alto?', {}, 250),
    node('servicio_a', 'mock.service', 'Servicio A', {}, 500),
  ],
  edges: [
    { id: 'e1', source: 'inicio', sourceHandle: 'out', target: 'alto' },
    { id: 'e2', source: 'alto', sourceHandle: 'true', target: 'servicio_a' },
  ],
};

export const LLM_DEFINITION = {
  ...DEFINITION,
  nodes: [...DEFINITION.nodes, node('clasificar', 'llm.classify', 'Clasificar', {}, 750)],
};

export const run = (overrides: Partial<Run> = {}): Run => ({
  id: RUN_ID,
  workflowId: WORKFLOW_ID,
  versionNumber: 2,
  status: 'running',
  triggeredBy: { id: '0192f0a0-0000-7000-8000-000000000001', name: 'Ana' },
  rerunOf: null,
  correlationId: CORRELATION_ID,
  error: null,
  createdAt: NOW,
  startedAt: NOW,
  finishedAt: null,
  ...overrides,
});

export const step = (nodeId: string, overrides: Partial<RunStep> = {}): RunStep => ({
  nodeId,
  nodeType:
    nodeId === 'inicio' ? 'trigger.manual' : nodeId === 'alto' ? 'logic.condition' : 'mock.service',
  status: 'pending',
  attempts: 0,
  startedAt: null,
  finishedAt: null,
  durationMs: null,
  error: null,
  ...overrides,
});

export interface Handlers {
  flags?: Record<string, boolean>;
  role?: Role;
  versions?: unknown[];
  definition?: unknown;
  limits?: unknown;
  /** Return a response for a request, or undefined to fall through to the defaults. */
  on?: (url: string, init: RequestInit) => Response | undefined;
}

const VERSION = {
  number: 2,
  note: null,
  publishedAt: NOW,
  publishedBy: { id: '0192f0a0-0000-7000-8000-000000000001', name: 'Ana' },
  nodeCount: 3,
  edgeCount: 2,
  nodeTypes: [],
  active: true,
};

export function mount(path: string, handlers: Handlers = {}) {
  const flags = {
    'identity-enabled': true,
    'dag-editor-enabled': true,
    'execution-enabled': true,
    ...handlers.flags,
  };
  const fetchMock = vi.fn((url: string, init: RequestInit = {}) => {
    const custom = handlers.on?.(url, init);
    if (custom) return Promise.resolve(custom);
    if (url.endsWith('/features')) return Promise.resolve(json(flags));
    if (url.endsWith('/auth/session'))
      return Promise.resolve(json(session(handlers.role ?? 'viewer')));
    if (url.endsWith('/limits')) {
      return Promise.resolve(
        json(
          handlers.limits ?? {
            maxNodes: 50,
            maxEdges: 100,
            maxDefinitionBytes: 262144,
            maxConcurrentRuns: 5,
            source: 'default',
          },
        ),
      );
    }
    if (/\/workflows\/[0-9a-f-]{36}\/versions$/.test(url)) {
      return Promise.resolve(json(handlers.versions ?? [VERSION]));
    }
    if (/\/versions\/\d+$/.test(url)) {
      return Promise.resolve(json({ ...VERSION, definition: handlers.definition ?? DEFINITION }));
    }
    if (/\/workflows\/[0-9a-f-]{36}$/.test(url)) {
      return Promise.resolve(
        json({
          id: WORKFLOW_ID,
          name: 'Soporte',
          draftRevision: 2,
          draftUpdatedAt: NOW,
          activeVersionNumber: 2,
          draft: DEFINITION,
        }),
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
  return { fetchMock, router, queryClient, user: userEvent.setup() };
}

/** EventSource stand-in the tests drive by hand. */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();

  constructor(
    readonly url: string,
    readonly init?: EventSourceInit,
  ) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) } as MessageEvent<string>);
    }
  }
}
