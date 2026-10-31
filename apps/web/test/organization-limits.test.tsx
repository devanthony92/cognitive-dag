import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FEATURE_FLAGS } from '@cognitive-dag/contracts';
import { OrganizationLimits } from '../src/features/organizations/OrganizationLimits';

const ORG_ID = '0192f0a0-0000-7000-8000-0000000000aa';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stub(limits: unknown, editorEnabled = true) {
  const fetchMock = vi.fn((url: string) => {
    if (url.endsWith('/features')) {
      return Promise.resolve(json({ [FEATURE_FLAGS.dagEditorEnabled]: editorEnabled }));
    }
    if (url.endsWith('/limits')) return Promise.resolve(json(limits));
    return Promise.resolve(json({}, 404));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderLimits() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <OrganizationLimits organizationId={ORG_ID} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('OrganizationLimits (US7)', () => {
  it('shows the platform defaults to any member, read-only', async () => {
    stub({
      maxNodes: 50,
      maxEdges: 100,
      maxDefinitionBytes: 262144,
      maxConcurrentRuns: 5,
      source: 'default',
    });
    renderLimits();

    expect(await screen.findByText('Límites de los workflows')).toBeDefined();
    expect(screen.getByText('Nodos por workflow').parentElement?.textContent).toContain('50');
    expect(screen.getByText('Conexiones por workflow').parentElement?.textContent).toContain('100');
    expect(screen.getByText('Tamaño de la definición').parentElement?.textContent).toContain(
      '256 KB',
    );
    expect(screen.getByText(/por defecto de la plataforma/)).toBeDefined();
  });

  it('says when the limits are the organization own ones, and who sets them', async () => {
    stub({
      maxNodes: 3,
      maxEdges: 100,
      maxDefinitionBytes: 262144,
      maxConcurrentRuns: 5,
      source: 'organization',
    });
    renderLimits();

    expect((await screen.findByText('Nodos por workflow')).parentElement?.textContent).toContain(
      '3',
    );
    expect(screen.getByText(/propios de esta organización/)).toBeDefined();
    expect(screen.getByText(/operador de la plataforma/)).toBeDefined();
  });

  it('offers no way to change them: no inputs and no buttons', async () => {
    stub({
      maxNodes: 50,
      maxEdges: 100,
      maxDefinitionBytes: 262144,
      maxConcurrentRuns: 5,
      source: 'default',
    });
    renderLimits();
    await screen.findByText('Nodos por workflow');

    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('shows nothing, and asks nothing of the limits endpoint, with the editor flag off', async () => {
    const fetchMock = stub({}, false);
    renderLimits();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(screen.queryByText('Límites de los workflows')).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/limits'))).toBe(false);
  });
});
