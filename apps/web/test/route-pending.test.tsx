import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route as CompilerRoute } from '../src/routes/orgs.$organizationId.workflows.new';
import { routerDefaults } from '../src/components/route/router-defaults';

function openSlow(delayMs: number) {
  const root = createRootRoute({ component: Outlet });
  const slow = createRoute({
    getParentRoute: () => root,
    path: '/slow',
    loader: () => new Promise<string>((resolve) => setTimeout(() => resolve('listo'), delayMs)),
    component: () => <h1>Contenido</h1>,
  });
  const router = createRouter({
    routeTree: root.addChildren([slow]),
    history: createMemoryHistory({ initialEntries: ['/slow'] }),
    ...routerDefaults,
  });
  render(<RouterProvider router={router} />);
}

describe('route pending state (FR-017)', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows nothing before 150 ms and a skeleton with role status after', async () => {
    openSlow(2000);
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(screen.queryByRole('status')).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(100));
    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/Cargando/);
  });

  it('reserves its height so the content replacing it does not shift the layout', async () => {
    openSlow(2000);
    await act(() => vi.advanceTimersByTimeAsync(200));
    const status = await screen.findByRole('status');
    expect(status.className).toMatch(/min-h-/);
  });

  it('is replaced by the content once the route resolves', async () => {
    openSlow(1000);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(await screen.findByRole('heading', { level: 1, name: 'Contenido' })).toBeDefined();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the editor skeleton at once on "Describir workflow" (no blank screen)', () => {
    expect(CompilerRoute.options.pendingMs).toBe(0);
    expect(CompilerRoute.options.pendingComponent).toBeDefined();
    const Skeleton = CompilerRoute.options.pendingComponent!;
    render(<Skeleton />);
    expect(screen.getByRole('status').textContent).toMatch(/Cargando el editor/);
  });
});
