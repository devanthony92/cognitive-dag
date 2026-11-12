import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRouteRetries } from '../src/components/route/RouteError';
import { CORRELATION_ID, json, openApp, problem } from './route-harness';

const FEATURES = /\/features$/;
const SESSION = /\/auth\/session$/;
const sessionCalls = (fetchMock: ReturnType<typeof openApp>['fetchMock']) =>
  fetchMock.mock.calls.filter(([url]) => SESSION.test(url)).length;

describe('route error panel (FR-014 to FR-016)', () => {
  afterEach(() => {
    cleanup();
    resetRouteRetries();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows the detail and a copyable correlation id of a problem, inside the shell', async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, 'writeText');
    openApp('/', (url) => {
      if (FEATURES.test(url)) return Promise.resolve(json({}));
      return Promise.resolve(problem(500, 'No pudimos cargar tus datos.'));
    });

    expect(await screen.findByText('No pudimos cargar tus datos.')).toBeDefined();
    expect(screen.getByText(CORRELATION_ID)).toBeDefined();
    // The shell (banner and brand) is still there around the panel.
    expect(screen.getByRole('banner')).toBeDefined();
    expect(screen.getAllByRole('main')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /copiar/i }));
    expect(write).toHaveBeenCalledWith(CORRELATION_ID);

    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Volver' })).toBeDefined();
    expect(screen.queryByText(/something went wrong/i)).toBeNull();
  });

  it('moves the focus to the panel heading', async () => {
    openApp('/', (url) =>
      Promise.resolve(FEATURES.test(url) ? json({}) : problem(500, 'No pudimos cargar tus datos.')),
    );
    const heading = await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('names a missing chunk as a new version and offers Recargar', async () => {
    openApp('/', (url) => {
      if (FEATURES.test(url)) return Promise.resolve(json({}));
      return Promise.reject(
        new TypeError('Failed to fetch dynamically imported module: http://x/assets/a.js'),
      );
    });
    expect(await screen.findByText('Hay una versión nueva')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Recargar' })).toBeDefined();
    expect(screen.queryByText(/something went wrong/i)).toBeNull();
  });

  it('shows the not-found panel inside the shell for an unknown route', async () => {
    openApp('/no-existe', (url) =>
      Promise.resolve(FEATURES.test(url) ? json({}) : problem(401, 'x')),
    );
    expect(await screen.findByText('No encontramos esa página')).toBeDefined();
    expect(screen.getByRole('banner')).toBeDefined();
    expect(screen.getByRole('link', { name: /volver/i })).toBeDefined();
  });

  describe('503 and network failures', () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));

    const unavailable = (url: string) =>
      Promise.resolve(
        FEATURES.test(url)
          ? json({})
          : new Response('<html>503</html>', {
              status: 503,
              headers: { 'Content-Type': 'text/html' },
            }),
      );
    const offline = (url: string) =>
      FEATURES.test(url)
        ? Promise.resolve(json({}))
        : Promise.reject(new TypeError('Failed to fetch'));

    it.each([
      ['a 503', unavailable],
      ['a network failure', offline],
    ])('retries %s after 1, 2 and 4 seconds, three times at most', async (_name, impl) => {
      const { fetchMock } = openApp('/', impl);
      expect(await screen.findByText('El servicio se está reiniciando')).toBeDefined();
      const first = sessionCalls(fetchMock);

      await act(() => vi.advanceTimersByTimeAsync(900));
      expect(sessionCalls(fetchMock)).toBe(first);
      await act(() => vi.advanceTimersByTimeAsync(200));
      await waitFor(() => expect(sessionCalls(fetchMock)).toBe(first + 1));

      await act(() => vi.advanceTimersByTimeAsync(1900));
      expect(sessionCalls(fetchMock)).toBe(first + 1);
      await act(() => vi.advanceTimersByTimeAsync(200));
      await waitFor(() => expect(sessionCalls(fetchMock)).toBe(first + 2));

      await act(() => vi.advanceTimersByTimeAsync(3900));
      expect(sessionCalls(fetchMock)).toBe(first + 2);
      await act(() => vi.advanceTimersByTimeAsync(200));
      await waitFor(() => expect(sessionCalls(fetchMock)).toBe(first + 3));

      // After the third retry only the manual button remains.
      await act(() => vi.advanceTimersByTimeAsync(20_000));
      expect(sessionCalls(fetchMock)).toBe(first + 3);
      expect(screen.getByRole('button', { name: 'Reintentar' })).toBeDefined();
      expect(screen.getByRole('banner')).toBeDefined();
    });
  });
});
