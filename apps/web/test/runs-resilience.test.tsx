import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrganizationRun } from '@cognitive-dag/contracts';
import {
  FakeEventSource,
  NEW_RUN_ID,
  ORG_ID,
  RUN_ID,
  DEFINITION,
  WORKFLOW_ID,
  json,
  mount,
  problem,
  run,
  step,
} from './runs-harness';

const RESILIENCE = { 'resilience-enabled': true };
const LIST = `/orgs/${ORG_ID}/runs`;
const DETAIL = `/orgs/${ORG_ID}/runs/${RUN_ID}`;
const ORG_RUNS_URL = /\/organizations\/[0-9a-f-]{36}\/runs\?/;
const FINISHED = '2026-10-30T12:00:05.000Z';

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const orgRun = (overrides: Partial<OrganizationRun> = {}): OrganizationRun => ({
  ...run({ status: 'succeeded', finishedAt: FINISHED }),
  workflowName: 'Soporte técnico',
  failedNodeId: null,
  ...overrides,
});

const failedRun = (overrides: Partial<OrganizationRun> = {}) =>
  orgRun({
    status: 'failed',
    failedNodeId: 'servicio_a',
    error: {
      code: 'MOCK_SERVICE_PERMANENT',
      message: 'El servicio rechazó la solicitud.',
      class: 'permanent',
    },
    ...overrides,
  });

describe('organization runs (US6)', () => {
  const open = (
    items: OrganizationRun[],
    extra?: (url: string, init: RequestInit) => Response | undefined,
    path = LIST,
    flags: Record<string, boolean> = RESILIENCE,
  ) =>
    mount(path, {
      flags,
      on: (url, init) => {
        const custom = extra?.(url, init);
        if (custom) return custom;
        if (ORG_RUNS_URL.test(url)) return json({ items, nextCursor: null });
        if (url.endsWith('/workflows')) {
          return json([
            {
              id: WORKFLOW_ID,
              name: 'Soporte técnico',
              draftRevision: 2,
              draftUpdatedAt: FINISHED,
              activeVersionNumber: 2,
            },
          ]);
        }
        return undefined;
      },
    });

  it('lists the runs with workflow, failed node and the class of the error', async () => {
    open([failedRun(), orgRun({ id: NEW_RUN_ID })]);
    const table = within(await screen.findByRole('table'));
    const row = table.getByText('Fallida').closest('tr')!;
    expect(within(row).getByText('Soporte técnico')).toBeDefined();
    expect(within(row).getByText('Permanente')).toBeDefined();
    expect(within(row).getByText('servicio_a')).toBeDefined();
    expect(table.getByText('Completada')).toBeDefined();
  });

  it('is in the navigation, and the page does not exist with the flag off', async () => {
    open([orgRun()]);
    expect(await screen.findByRole('link', { name: 'Ejecuciones' })).toBeDefined();
    cleanup();

    const { router } = open([orgRun()], undefined, LIST, {});
    await waitFor(() => expect(router.state.location.pathname).toBe(`/orgs/${ORG_ID}`));
    expect(screen.queryByRole('link', { name: 'Ejecuciones' })).toBeNull();
  });

  it('asks the API for the status and workflow chosen, and keeps them in the address', async () => {
    const { user, fetchMock, router } = open([failedRun()]);
    await screen.findByRole('table');

    await user.selectOptions(screen.getByLabelText('Estado'), 'failed');
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('status=failed'))).toBe(
        true,
      ),
    );
    expect(router.state.location.search).toMatchObject({ status: 'failed' });

    await user.selectOptions(await screen.findByLabelText('Workflow'), WORKFLOW_ID);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes(`workflowId=${WORKFLOW_ID}`)),
      ).toBe(true),
    );

    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).toBeNull(),
    );
  });

  it('opens with the filters of the address', async () => {
    const { fetchMock } = open([], undefined, `${LIST}?status=failed`);
    expect(await screen.findByText('Ninguna ejecución coincide con los filtros.')).toBeDefined();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('status=failed'))).toBe(true);
    expect(screen.getByLabelText<HTMLSelectElement>('Estado').value).toBe('failed');
  });

  it('says the organization has no runs yet', async () => {
    open([]);
    expect(await screen.findByText(/todavía no tiene ejecuciones/)).toBeDefined();
  });

  it('shows the error of the list and lets the user retry', async () => {
    let calls = 0;
    const { user } = open([], (url) => {
      if (!ORG_RUNS_URL.test(url)) return undefined;
      calls += 1;
      return calls === 1
        ? problem(503, 'SERVICE_UNAVAILABLE', 'El servicio no está disponible.')
        : json({ items: [orgRun()], nextCursor: null });
    });
    expect((await screen.findByRole('alert')).textContent).toContain('no está disponible');
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(within(await screen.findByRole('table')).getByText('Completada')).toBeDefined();
  });

  it('reruns a run and goes to the new one', async () => {
    const bodies: Array<{ url: string; body: unknown }> = [];
    const { user, router } = open([failedRun()], (url, init) => {
      if (init.method === 'POST' && url.endsWith(`/runs/${RUN_ID}/rerun`)) {
        bodies.push({ url, body: init.body });
        return json(run({ id: NEW_RUN_ID, status: 'queued', rerunOf: RUN_ID }), 202);
      }
      return undefined;
    });
    await user.click(await screen.findByRole('button', { name: 'Reejecutar' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/orgs/${ORG_ID}/runs/${NEW_RUN_ID}`),
    );
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.body).toBeUndefined();
  });

  it('reruns from the failed node', async () => {
    const bodies: unknown[] = [];
    const { user, router } = open([failedRun()], (url, init) => {
      if (init.method === 'POST' && url.endsWith(`/runs/${RUN_ID}/rerun`)) {
        bodies.push(JSON.parse(init.body as string));
        return json(
          run({ id: NEW_RUN_ID, status: 'queued', rerunOf: RUN_ID, rerunFromNodeId: 'servicio_a' }),
          202,
        );
      }
      return undefined;
    });
    await user.click(
      await screen.findByRole('button', { name: 'Reejecutar desde el nodo fallido' }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/orgs/${ORG_ID}/runs/${NEW_RUN_ID}`),
    );
    expect(bodies).toEqual([{ fromNodeId: 'servicio_a' }]);
  });

  it('does not offer to rerun what is still running, nor from a node that did not fail', async () => {
    open([orgRun({ status: 'running', finishedAt: null }), orgRun({ id: NEW_RUN_ID })]);
    await screen.findByRole('table');
    expect(screen.getAllByRole('button', { name: 'Reejecutar' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Reejecutar desde el nodo fallido' })).toBeNull();
  });

  it('explains when the input of the run is gone', async () => {
    const { user } = open([failedRun()], (url, init) =>
      init.method === 'POST' && url.endsWith('/rerun')
        ? problem(410, 'RUN_INPUT_EXPIRED', 'Expiró.')
        : undefined,
    );
    await user.click(await screen.findByRole('button', { name: 'Reejecutar' }));
    expect((await screen.findByRole('alert')).textContent).toContain('ya no se conserva');
  });
});

describe('run detail with resilience (US5)', () => {
  const detail = (overrides = {}, steps = [step('inicio'), step('alto'), step('servicio_a')]) =>
    json({ ...run(overrides), steps, definition: DEFINITION });

  const open = (
    payload: () => Response,
    extra?: (url: string, init: RequestInit) => Response | undefined,
    flags: Record<string, boolean> = RESILIENCE,
    path = DETAIL,
  ) =>
    mount(path, {
      flags,
      on: (url, init) => {
        const custom = extra?.(url, init);
        if (custom) return custom;
        return /\/runs\/[0-9a-f-]{36}$/.test(url) && (init.method ?? 'GET') === 'GET'
          ? payload()
          : undefined;
      },
    });

  const finishedSteps = () => [
    step('inicio', { status: 'succeeded', attempts: 1, durationMs: 4 }),
    step('alto', { status: 'succeeded', durationMs: 1 }),
    step('servicio_a', {
      status: 'failed',
      attempts: 1,
      error: { code: 'MOCK_SERVICE_PERMANENT', message: 'No se pudo.', class: 'permanent' },
    }),
  ];

  // The graph listens to the mouse down of d3, which jsdom cannot serve: a plain click selects.
  async function selectNode(_user: ReturnType<typeof mount>['user'], label: string) {
    const graph = await screen.findByLabelText('Grafo de la ejecución');
    fireEvent.click(await within(graph).findByText(label));
  }

  it('offers to rerun from a node of a finished run and sends the node', async () => {
    const bodies: unknown[] = [];
    const { user, router } = open(
      () => detail({ status: 'failed', finishedAt: FINISHED }, finishedSteps()),
      (url, init) => {
        if (init.method === 'POST' && url.endsWith('/rerun')) {
          bodies.push(JSON.parse(init.body as string));
          return json(run({ id: NEW_RUN_ID, status: 'queued', rerunOf: RUN_ID }), 202);
        }
        return undefined;
      },
    );
    await selectNode(user, 'Servicio A');
    await user.click(await screen.findByRole('button', { name: 'Reejecutar desde aquí' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/orgs/${ORG_ID}/runs/${NEW_RUN_ID}`),
    );
    expect(bodies).toEqual([{ fromNodeId: 'servicio_a' }]);
  });

  it('does not offer it while the run is in progress, nor with the flag off', async () => {
    const { user } = open(() =>
      detail({}, [step('inicio', { status: 'succeeded' }), step('alto'), step('servicio_a')]),
    );
    await selectNode(user, 'Servicio A');
    expect(screen.queryByRole('button', { name: 'Reejecutar desde aquí' })).toBeNull();
    cleanup();

    const off = open(
      () => detail({ status: 'failed', finishedAt: FINISHED }, finishedSteps()),
      undefined,
      {},
    );
    await selectNode(off.user, 'Servicio A');
    expect(screen.queryByRole('button', { name: 'Reejecutar desde aquí' })).toBeNull();
    expect(screen.queryByText(/Clase de error/)).toBeNull();
  });

  it('shows the class of the error in the panel of the step', async () => {
    const { user } = open(() =>
      detail({ status: 'failed', finishedAt: FINISHED }, finishedSteps()),
    );
    await selectNode(user, 'Servicio A');
    const panel = await screen.findByLabelText('Detalle del nodo');
    expect(within(panel).getByText(/Clase de error: Permanente/)).toBeDefined();
    expect(within(panel).getByText('MOCK_SERVICE_PERMANENT')).toBeDefined();
  });

  it('marks a reused node and links to the original run with that node', async () => {
    const ORIGINAL_ID = '0192f0a0-0000-7000-8000-0000000000b9';
    const { user, router } = open(() =>
      detail(
        {
          status: 'succeeded',
          finishedAt: FINISHED,
          rerunOf: ORIGINAL_ID,
          rerunFromNodeId: 'alto',
        },
        [
          step('inicio', { status: 'succeeded' }),
          step('alto', { status: 'succeeded' }),
          step('servicio_a', { status: 'reused' }),
        ],
      ),
    );
    const graph = await screen.findByLabelText('Grafo de la ejecución');
    expect(await within(graph).findByText('Reutilizado')).toBeDefined();

    await selectNode(user, 'Servicio A');
    const panel = await screen.findByLabelText('Detalle del nodo');
    expect(within(panel).getByText(/no se ejecutó de nuevo/)).toBeDefined();
    await user.click(
      within(panel).getByRole('link', { name: 'Ver este nodo en la ejecución original' }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/orgs/${ORG_ID}/runs/${ORIGINAL_ID}`),
    );
    expect(router.state.location.search).toMatchObject({ node: 'servicio_a' });
  });

  it('opens the panel of the node named in the address', async () => {
    open(
      () => detail({ status: 'failed', finishedAt: FINISHED }, finishedSteps()),
      undefined,
      RESILIENCE,
      `${DETAIL}?node=servicio_a`,
    );
    const panel = await screen.findByLabelText('Detalle del nodo');
    expect(await within(panel).findByText('Servicio A')).toBeDefined();
  });

  it('shows “Esperando por el límite” while the step waits, and clears it live', async () => {
    const { user } = open(() =>
      detail({}, [
        step('inicio', { status: 'succeeded' }),
        step('alto', { status: 'succeeded' }),
        step('servicio_a', { status: 'running', waitingReason: 'rate_limited' }),
      ]),
    );
    const graph = await screen.findByLabelText('Grafo de la ejecución');
    expect(await within(graph).findByText('Esperando por el límite')).toBeDefined();

    await selectNode(user, 'Servicio A');
    const panel = await screen.findByLabelText('Detalle del nodo');
    expect(within(panel).getByText('Esperando por el límite')).toBeDefined();

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    FakeEventSource.instances[0]!.emit('step', {
      type: 'step',
      step: step('servicio_a', { status: 'running', waitingReason: null }),
    });
    await waitFor(() => expect(screen.queryByText('Esperando por el límite')).toBeNull());
  });

  it('shows the waiting that arrives over the stream', async () => {
    open(() =>
      detail({}, [
        step('inicio', { status: 'succeeded' }),
        step('alto', { status: 'succeeded' }),
        step('servicio_a', { status: 'running' }),
      ]),
    );
    const graph = await screen.findByLabelText('Grafo de la ejecución');
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    expect(within(graph).queryByText('Esperando por el límite')).toBeNull();
    FakeEventSource.instances[0]!.emit('step', {
      type: 'step',
      step: step('servicio_a', { status: 'running', waitingReason: 'rate_limited' }),
    });
    expect(await within(graph).findByText('Esperando por el límite')).toBeDefined();
  });

  it('says why a rerun from a node cannot be done', async () => {
    const { user } = open(
      () => detail({ status: 'failed', finishedAt: FINISHED }, finishedSteps()),
      (url, init) =>
        init.method === 'POST' && url.endsWith('/rerun')
          ? problem(410, 'RUN_INPUT_EXPIRED', 'Expiró.')
          : undefined,
    );
    await selectNode(user, 'Servicio A');
    await user.click(await screen.findByRole('button', { name: 'Reejecutar desde aquí' }));
    expect(
      (await screen.findAllByRole('alert')).some((el) =>
        /ya no se conserva/.test(el.textContent ?? ''),
      ),
    ).toBe(true);
  });
});
