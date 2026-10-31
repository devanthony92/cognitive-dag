import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LLM_DEFINITION,
  NEW_RUN_ID,
  ORG_ID,
  WORKFLOW_ID,
  json,
  mount,
  problem,
  run,
} from './runs-harness';

const EDITOR = `/orgs/${ORG_ID}/workflows/${WORKFLOW_ID}`;
const runButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Ejecutar' });
const START_URL = /\/workflows\/[0-9a-f-]{36}\/runs$/;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Run button and form (US1, FR-020)', () => {
  it('shows no run controls while execution-enabled is off', async () => {
    const { fetchMock } = mount(EDITOR, { flags: { 'execution-enabled': false } });
    await screen.findByRole('heading', { name: 'Soporte' });

    expect(screen.queryByRole('button', { name: 'Ejecutar' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Ejecuciones' })).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => /\/runs/.test(String(url)))).toBe(false);
  });

  it('disables the button and says why when there is no active version', async () => {
    mount(EDITOR, { versions: [] });

    expect(await screen.findByText(/Publica una versión/)).toBeDefined();
    expect(runButton().disabled).toBe(true);
  });

  it('disables the button and names the nodes that cannot run yet', async () => {
    mount(EDITOR, { definition: LLM_DEFINITION });

    expect(await screen.findByText(/Clasificar \(desde F5\)/)).toBeDefined();
    expect(runButton().disabled).toBe(true);
  });

  it('builds the form from the trigger fields, validates, and opens the run', async () => {
    const { user, fetchMock, router } = mount(EDITOR, {
      on: (url, init) =>
        START_URL.test(url) && init.method === 'POST' ? json(run(), 202) : undefined,
    });

    await waitFor(() => expect(runButton().disabled).toBe(false));
    await user.click(screen.getByRole('button', { name: 'Ejecutar' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('versión activa (2)');

    // Empty: the form blocks the request and says which field.
    await user.click(screen.getAllByRole('button', { name: 'Ejecutar' }).at(-1)!);
    expect(await screen.findByText('Es obligatorio.')).toBeDefined();
    expect(fetchMock.mock.calls.some(([url]) => START_URL.test(String(url)))).toBe(false);

    await user.type(screen.getByLabelText('monto'), '150');
    await user.click(screen.getAllByRole('button', { name: 'Ejecutar' }).at(-1)!);

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/orgs/${ORG_ID}/runs/${run().id}`),
    );
    const post = fetchMock.mock.calls.find(
      ([url, init]) => START_URL.test(String(url)) && init?.method === 'POST',
    )!;
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ input: { monto: 150 } });
  });

  it('puts the API field errors (RUN_INPUT_INVALID) on the field', async () => {
    const { user } = mount(EDITOR, {
      on: (url, init) =>
        START_URL.test(url) && init.method === 'POST'
          ? problem(422, 'RUN_INPUT_INVALID', 'La entrada no es válida.', {
              errors: [{ field: 'monto', message: 'Debe ser un número.' }],
            })
          : undefined,
    });
    await waitFor(() => expect(runButton().disabled).toBe(false));
    await user.click(screen.getByRole('button', { name: 'Ejecutar' }));
    await user.type(await screen.findByLabelText('monto'), '7');
    await user.click(screen.getAllByRole('button', { name: 'Ejecutar' }).at(-1)!);

    expect(await screen.findByText('Debe ser un número.')).toBeDefined();
    expect(screen.getByLabelText('monto').getAttribute('aria-invalid')).toBe('true');
  });

  it('explains the concurrent run limit (RUN_LIMIT_REACHED) with the wait', async () => {
    const { user } = mount(EDITOR, {
      on: (url, init) =>
        START_URL.test(url) && init.method === 'POST'
          ? problem(
              429,
              'RUN_LIMIT_REACHED',
              'Tu organización alcanzó el máximo de 1 ejecución en curso.',
              {
                retryAfterSeconds: 5,
              },
            )
          : undefined,
    });
    await waitFor(() => expect(runButton().disabled).toBe(false));
    await user.click(screen.getByRole('button', { name: 'Ejecutar' }));
    await user.type(await screen.findByLabelText('monto'), '7');
    await user.click(screen.getAllByRole('button', { name: 'Ejecutar' }).at(-1)!);

    expect(await screen.findByText(/alcanzó el máximo de 1 ejecución/)).toBeDefined();
    expect(screen.getByText(/Vuelve a intentarlo en 5 segundos/)).toBeDefined();
    expect(screen.getByRole('link', { name: 'la lista de ejecuciones' })).toBeDefined();
  });

  it('reports a version that stopped being runnable (WORKFLOW_NOT_RUNNABLE)', async () => {
    const { user } = mount(EDITOR, {
      on: (url, init) =>
        START_URL.test(url) && init.method === 'POST'
          ? problem(409, 'WORKFLOW_NOT_RUNNABLE', 'No se puede ejecutar.', {
              reason: 'archived',
            })
          : undefined,
    });
    await waitFor(() => expect(runButton().disabled).toBe(false));
    await user.click(screen.getByRole('button', { name: 'Ejecutar' }));
    await user.type(await screen.findByLabelText('monto'), '7');
    await user.click(screen.getAllByRole('button', { name: 'Ejecutar' }).at(-1)!);

    expect(await screen.findByText(/archivado y no se puede ejecutar/)).toBeDefined();
  });
});

describe('run routes behind the flag', () => {
  it('sends the run routes back to the organization when execution-enabled is off', async () => {
    const list = mount(`/orgs/${ORG_ID}/workflows/${WORKFLOW_ID}/runs`, {
      flags: { 'execution-enabled': false },
    });
    await waitFor(() => expect(list.router.state.location.pathname).toBe(`/orgs/${ORG_ID}`));
    cleanup();

    const detail = mount(`/orgs/${ORG_ID}/runs/${NEW_RUN_ID}`, {
      flags: { 'execution-enabled': false },
    });
    await waitFor(() => expect(detail.router.state.location.pathname).toBe(`/orgs/${ORG_ID}`));
    expect(detail.fetchMock.mock.calls.some(([url]) => /\/runs/.test(String(url)))).toBe(false);
  });
});
