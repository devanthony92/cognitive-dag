import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PingPanel } from '../src/features/ping/PingPanel';

function mockFeatures(flags: Record<string, boolean>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(flags), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ),
  );
}

function renderPanel(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PingPanel />
    </QueryClientProvider>,
  );
}

describe('PingPanel', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('hides the action when ping-enabled is false', async () => {
    mockFeatures({ 'ping-enabled': false });
    renderPanel();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('button', { name: 'Ejecutar ping' })).toBeNull();
  });

  it('shows the action when ping-enabled is true', async () => {
    mockFeatures({ 'ping-enabled': true });
    renderPanel();
    expect(await screen.findByRole('button', { name: 'Ejecutar ping' })).toBeDefined();
  });
});
