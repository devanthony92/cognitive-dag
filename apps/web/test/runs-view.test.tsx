import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const LIST = `/orgs/${ORG_ID}/workflows/${WORKFLOW_ID}/runs`;
const DETAIL = `/orgs/${ORG_ID}/runs/${RUN_ID}`;
const LIST_URL = /\/workflows\/[0-9a-f-]{36}\/runs\?/;

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const detail = (overrides = {}, steps = [step('inicio'), step('alto'), step('servicio_a')]) =>
  json({ ...run(overrides), steps, definition: DEFINITION });

describe('run list (US3)', () => {
  it('lists the runs and pages with the cursor', async () => {
    const second = run({
      id: NEW_RUN_ID,
      status: 'failed',
      finishedAt: '2026-10-30T12:00:05.000Z',
    });
    const { user, fetchMock } = mount(LIST, {
      on: (url) => {
        if (!LIST_URL.test(url)) return undefined;
        return url.includes('cursor=next')
          ? json({ items: [second], nextCursor: null })
          : json({
              items: [run({ status: 'succeeded', finishedAt: '2026-10-30T12:00:03.000Z' })],
              nextCursor: 'next',
            });
      },
    });

    expect(await screen.findByText('Completada')).toBeDefined();
    expect(screen.queryByText('Fallida')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect(await screen.findByText('Fallida')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Cargar más' })).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('cursor=next'))).toBe(true);
    expect(screen.getByText('3 s')).toBeDefined();
  });

  it('says there are no runs yet', async () => {
    mount(LIST, {
      on: (url) => (LIST_URL.test(url) ? json({ items: [], nextCursor: null }) : undefined),
    });
    expect(await screen.findByText(/todavía no se ha ejecutado/)).toBeDefined();
  });

  it('shows the error and lets the user retry', async () => {
    let calls = 0;
    const { user } = mount(LIST, {
      on: (url) => {
        if (!LIST_URL.test(url)) return undefined;
        calls += 1;
        return calls === 1
          ? problem(503, 'SERVICE_UNAVAILABLE', 'El servicio no está disponible.')
          : json({
              items: [run({ status: 'succeeded', finishedAt: '2026-10-30T12:00:03.000Z' })],
              nextCursor: null,
            });
      },
    });
    expect((await screen.findByRole('alert')).textContent).toContain('no está disponible');
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Completada')).toBeDefined();
  });
});

describe('run detail (US3)', () => {
  const open = (
    payload: () => Response,
    extra?: (url: string, init: RequestInit) => Response | undefined,
  ) =>
    mount(DETAIL, {
      on: (url, init) => {
        const custom = extra?.(url, init);
        if (custom) return custom;
        return /\/runs\/[0-9a-f-]{36}$/.test(url) && (init.method ?? 'GET') === 'GET'
          ? payload()
          : undefined;
      },
    });

  it('draws the graph with the state of every node and follows the stream', async () => {
    open(() =>
      detail({}, [
        step('inicio', { status: 'succeeded', attempts: 1, durationMs: 4 }),
        step('alto'),
        step('servicio_a'),
      ]),
    );

    const graph = await screen.findByLabelText('Grafo de la ejecución');
    await waitFor(() => expect(within(graph).getAllByText('Completado')).toHaveLength(1));
    expect(within(graph).getAllByText('Pendiente')).toHaveLength(2);

    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0]!;
    expect(source.url).toMatch(new RegExp(`/runs/${RUN_ID}/events$`));
    expect(source.init?.withCredentials).toBe(true);

    source.emit('step', {
      type: 'step',
      step: step('alto', { status: 'running', attempts: 1, startedAt: '2026-10-30T12:00:01.000Z' }),
    });
    await waitFor(() => expect(within(graph).getAllByText('En curso')).toHaveLength(1));

    source.emit('run', {
      type: 'run',
      run: run({ status: 'succeeded', finishedAt: '2026-10-30T12:00:05.000Z' }),
    });
    // Final: the stream is closed and the cancel button gives way to rerun.
    await waitFor(() => expect(source.closed).toBe(true));
    expect(screen.getByRole('button', { name: 'Reejecutar' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
  });

  it('replaces the whole state with the snapshot sent after a reconnection', async () => {
    open(() => detail());
    const graph = await screen.findByLabelText('Grafo de la ejecución');
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    FakeEventSource.instances[0]!.emit('snapshot', {
      type: 'snapshot',
      run: run(),
      steps: [
        step('inicio', { status: 'succeeded' }),
        step('alto', { status: 'succeeded' }),
        step('servicio_a', { status: 'running' }),
      ],
    });
    await waitFor(() => expect(within(graph).getAllByText('Completado')).toHaveLength(2));
  });

  it('keeps the page current by polling while the stream is down', async () => {
    let steps = [step('inicio', { status: 'running' }), step('alto'), step('servicio_a')];
    const { fetchMock } = open(() => detail({}, steps));
    const graph = await screen.findByLabelText('Grafo de la ejecución');
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    FakeEventSource.instances[0]!.onerror?.();
    expect(await screen.findByText(/Conexión en vivo interrumpida/)).toBeDefined();
    steps = [step('inicio', { status: 'succeeded' }), step('alto'), step('servicio_a')];

    await waitFor(() => expect(within(graph).getAllByText('Completado')).toHaveLength(1), {
      timeout: 4000,
    });
    const gets = fetchMock.mock.calls.filter(([url]) => /\/runs\/[0-9a-f-]{36}$/.test(String(url)));
    expect(gets.length).toBeGreaterThan(1);
  });

  it('shows attempts, duration, error and content of the selected node', async () => {
    open(
      () =>
        detail({ status: 'failed', finishedAt: '2026-10-30T12:00:05.000Z' }, [
          step('inicio', { status: 'succeeded', attempts: 1, durationMs: 4 }),
          step('alto', { status: 'succeeded', attempts: 1, durationMs: 2 }),
          step('servicio_a', {
            status: 'failed',
            attempts: 3,
            durationMs: 2500,
            error: { code: 'MOCK_FAILURE', message: 'El servicio simulado falló.' },
          }),
        ]),
      (url) =>
        /\/steps\/servicio_a\/io$/.test(url)
          ? json({ input: { config: { latencyMs: 100 } }, output: { ok: true }, truncated: false })
          : undefined,
    );

    fireEvent.click(await screen.findByText('Servicio A'));
    const panel = await screen.findByRole('complementary', { name: 'Detalle del nodo' });
    expect(within(panel).getByText('3')).toBeDefined();
    expect(within(panel).getByText('2,5 s')).toBeDefined();
    expect(within(panel).getByText('El servicio simulado falló.')).toBeDefined();
    expect((await within(panel).findAllByText(/latencyMs/))[0]).toBeDefined();
    expect(within(panel).getByText(/"ok": true/)).toBeDefined();
  });

  it('explains that logic nodes keep no content, without asking for it', async () => {
    const { fetchMock } = open(() =>
      detail({}, [step('inicio'), step('alto', { status: 'succeeded' }), step('servicio_a')]),
    );
    fireEvent.click(await screen.findByText('¿Monto alto?'));

    expect(await screen.findByText(/se evalúa dentro del motor/)).toBeDefined();
    expect(fetchMock.mock.calls.some(([url]) => /\/steps\//.test(String(url)))).toBe(false);
  });

  it('says the content expired (STEP_IO_EXPIRED)', async () => {
    open(
      () => detail({}, [step('inicio'), step('alto'), step('servicio_a', { status: 'succeeded' })]),
      (url) =>
        /\/steps\/servicio_a\/io$/.test(url)
          ? problem(410, 'STEP_IO_EXPIRED', 'El contenido ya no existe.')
          : undefined,
    );
    fireEvent.click(await screen.findByText('Servicio A'));

    expect(await screen.findByText(/ya no está disponible/)).toBeDefined();
  });

  it('shows the 404 of a run the user cannot see', async () => {
    open(() => problem(404, 'NOT_FOUND', 'No existe.'));
    expect(await screen.findByText('No existe.')).toBeDefined();
  });
});

describe('cancel and rerun (US4)', () => {
  const CANCEL = /\/runs\/[0-9a-f-]{36}\/cancel$/;
  const RERUN = /\/runs\/[0-9a-f-]{36}\/rerun$/;
  const get = (payload: () => Response) => (url: string, init: RequestInit) =>
    /\/runs\/[0-9a-f-]{36}$/.test(url) && (init.method ?? 'GET') === 'GET' ? payload() : undefined;

  it('cancels after confirmation and shows the run as cancelled', async () => {
    let cancelled = false;
    const { user, fetchMock } = mount(DETAIL, {
      on: (url, init) => {
        if (CANCEL.test(url)) {
          cancelled = true;
          return json(run({ status: 'cancelled' }), 202);
        }
        return get(() =>
          cancelled
            ? detail({ status: 'cancelled', finishedAt: '2026-10-30T12:00:05.000Z' })
            : detail(),
        )(url, init);
      },
    });

    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));
    const dialog = await screen.findByRole('dialog');
    expect(fetchMock.mock.calls.some(([url]) => CANCEL.test(String(url)))).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar ejecución' }));

    expect(await screen.findByRole('button', { name: 'Reejecutar' })).toBeDefined();
    expect(screen.getAllByText('Cancelada').length).toBeGreaterThan(0);
  });

  it('handles a run that finished before the cancellation (RUN_NOT_CANCELLABLE)', async () => {
    let finished = false;
    const { user } = mount(DETAIL, {
      on: (url, init) => {
        if (CANCEL.test(url)) {
          finished = true;
          return problem(409, 'RUN_NOT_CANCELLABLE', 'La ejecución ya terminó.');
        }
        return get(() =>
          finished
            ? detail({ status: 'succeeded', finishedAt: '2026-10-30T12:00:05.000Z' })
            : detail(),
        )(url, init);
      },
    });

    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar ejecución' }),
    );

    expect(await screen.findByText(/ya había terminado/)).toBeDefined();
    expect(await screen.findByRole('button', { name: 'Reejecutar' })).toBeDefined();
  });

  it('reruns a finished run and opens the new one', async () => {
    const { user, router } = mount(DETAIL, {
      on: (url, init) =>
        RERUN.test(url)
          ? json(run({ id: NEW_RUN_ID, rerunOf: RUN_ID }), 202)
          : get(() => detail({ status: 'failed', finishedAt: '2026-10-30T12:00:05.000Z' }))(
              url,
              init,
            ),
    });

    await user.click(await screen.findByRole('button', { name: 'Reejecutar' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/orgs/${ORG_ID}/runs/${NEW_RUN_ID}`),
    );
  });

  it('says the input is gone (RUN_INPUT_EXPIRED)', async () => {
    const { user } = mount(DETAIL, {
      on: (url, init) =>
        RERUN.test(url)
          ? problem(410, 'RUN_INPUT_EXPIRED', 'La entrada ya no existe.')
          : get(() => detail({ status: 'failed', finishedAt: '2026-10-30T12:00:05.000Z' }))(
              url,
              init,
            ),
    });

    await user.click(await screen.findByRole('button', { name: 'Reejecutar' }));
    expect(await screen.findByText(/la entrada de esta ejecución ya no se conserva/)).toBeDefined();
  });

  it('shows the concurrent run limit when a rerun is rejected (RUN_LIMIT_REACHED)', async () => {
    const { user } = mount(DETAIL, {
      on: (url, init) =>
        RERUN.test(url)
          ? problem(429, 'RUN_LIMIT_REACHED', 'Se alcanzó el máximo de ejecuciones en curso.', {
              retryAfterSeconds: 5,
            })
          : get(() => detail({ status: 'failed', finishedAt: '2026-10-30T12:00:05.000Z' }))(
              url,
              init,
            ),
    });

    await user.click(await screen.findByRole('button', { name: 'Reejecutar' }));
    expect(await screen.findByText(/máximo de ejecuciones en curso/)).toBeDefined();
  });
});
