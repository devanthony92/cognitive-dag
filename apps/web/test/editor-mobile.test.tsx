/// <reference types="node" />
/**
 * The editor on a phone (F10, FR-027, US6.7, T057; research R10): under 768 px the palette and the
 * configuration panel open as bottom sheets, «Añadir nodo» is a 44 px control and the whole flow
 * create → connect → configure → validate → publish works without a mouse or a keyboard.
 */
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
const stationCss = readFileSync('src/components/station/station.css', 'utf8');
import { FakeServer, json, mountEditor } from './editor-harness';
import { PHONE, stubMedia } from './media';

const station = (id: string) => document.querySelector(`[data-id="${id}"]`) as HTMLElement;
const isTouchSize = (element: Element) => /\b(?:h-11|size-11|min-h-11)\b/.test(element.className);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('editor under 768 px', () => {
  it('keeps the palette and the panel in bottom sheets, out of the way of the canvas', async () => {
    stubMedia(PHONE);
    mountEditor(new FakeServer({ schemaVersion: 1, nodes: [], edges: [] }));
    await screen.findByRole('button', { name: 'Guardar' });

    expect(screen.queryByRole('complementary', { name: 'Paleta de nodos' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Panel lateral' })).toBeNull();
    const add = screen.getByRole('button', { name: 'Añadir nodo' });
    expect(isTouchSize(add)).toBe(true);
    expect(isTouchSize(screen.getByRole('button', { name: 'Conectar' }))).toBe(true);
  });

  it('gives every port a 44 px touch zone around its 12 px dot', () => {
    expect(stationCss).toMatch(/\.station-port\s*\{[^}]*(?:width|inline-size):\s*12px/);
    expect(stationCss).toMatch(/\.station-port::before\s*\{[^}]*(?:width|inline-size):\s*44px/);
  });

  it('creates, connects, configures, validates and publishes a workflow', async () => {
    stubMedia(PHONE);
    const server = new FakeServer({ schemaVersion: 1, nodes: [], edges: [] });
    const { fetchMock, user } = mountEditor(server);
    const published: unknown[] = [];
    // Publishing answers with the new version; everything else is the fake server.
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init: RequestInit = {}) => {
        if (url.endsWith('/versions') && init.method === 'POST') {
          published.push(init);
          return Promise.resolve(
            json({
              number: 1,
              note: null,
              publishedAt: '2026-11-12T10:00:00.000Z',
              publishedBy: { id: '0192f0a0-0000-7000-8000-000000000001', name: 'Ana' },
              nodeCount: 2,
              edgeCount: 1,
              nodeTypes: ['trigger.manual', 'mock.service'],
              active: true,
            }),
          );
        }
        return fetchMock(url, init);
      }),
    );
    await screen.findByRole('button', { name: 'Guardar' });

    // Create: the palette is a sheet, and choosing a type closes it.
    await user.click(screen.getByRole('button', { name: 'Añadir nodo' }));
    let sheet = await screen.findByRole('dialog', { name: 'Añadir nodo' });
    await user.click(
      within(within(sheet).getByRole('complementary', { name: 'Paleta de nodos' })).getByRole(
        'button',
        { name: /Disparador manual/ },
      ),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(station('manual_1')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Añadir nodo' }));
    sheet = await screen.findByRole('dialog', { name: 'Añadir nodo' });
    await user.click(within(sheet).getByRole('button', { name: /Servicio simulado/ }));
    await waitFor(() => expect(station('service_1')).not.toBeNull());

    // Connect with taps: the source, «Conectar», then the destination.
    fireEvent.click(station('manual_1'));
    await user.click(screen.getByRole('button', { name: 'Conectar' }));
    fireEvent.click(station('service_1'));
    expect(await screen.findByText('Sin problemas')).toBeDefined();

    // Configure: the panel is a sheet too.
    await user.click(screen.getByRole('button', { name: 'Configurar' }));
    sheet = await screen.findByRole('dialog', { name: 'Configurar nodo' });
    const name = within(sheet).getByLabelText('Nombre del nodo');
    await user.clear(name);
    await user.type(name, 'Cobro');
    await user.click(within(sheet).getByRole('button', { name: 'Listo' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getAllByText('Cobro').length).toBeGreaterThan(0);

    // Validate, save and publish.
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(server.saves).toHaveLength(1));
    const publish = screen.getByRole('button', { name: 'Publicar' });
    await waitFor(() => expect(publish).toHaveProperty('disabled', false));
    await user.click(publish);
    await user.click(await screen.findByRole('button', { name: 'Publicar versión' }));
    await waitFor(() => expect(published).toHaveLength(1));
    expect(await screen.findByText(/Versión 1 publicada/)).toBeDefined();
  });
});
