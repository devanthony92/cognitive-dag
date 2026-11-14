/**
 * The editor with the keyboard alone (F10, FR-027, T056; WCAG 2.1.1 and 2.5.7): select a station,
 * move between stations, open its panel, move it, connect two stations without dragging and delete
 * one after confirming, with visible focus and a spoken announcement for every step.
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { edge, FakeServer, mountEditor, node } from './editor-harness';

const GENERATE = { instruction: 'Escribe un resumen.', language: 'es', maxLength: 1000 };

/** A trigger feeding «Resumir», and «Traducir» that nobody feeds yet. */
const DRAFT = {
  schemaVersion: 1,
  nodes: [
    node('manual_1', 'trigger.manual', 'Disparo', { inputSchema: [] }, 0, 0),
    node('generate_1', 'llm.generate', 'Resumir', GENERATE, 300, 0),
    node('generate_2', 'llm.generate', 'Traducir', GENERATE, 600, 0),
  ],
  edges: [edge('e1', 'manual_1', 'generate_1')],
};

const station = (id: string) => document.querySelector(`[data-id="${id}"]`) as HTMLElement;
const panel = () => screen.getByRole('complementary', { name: 'Panel lateral' });
const announcer = () => screen.getByRole('status', { name: 'Avisos del editor' });

async function ready() {
  const server = new FakeServer(DRAFT);
  const mounted = mountEditor(server);
  await screen.findByText('Resumir');
  return { server, ...mounted };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('editor with the keyboard', () => {
  it('describes every station: name, category, type and problems', async () => {
    await ready();
    expect(station('generate_1').getAttribute('aria-label')).toBe('Resumir, LLM, Generar texto');
    await waitFor(() =>
      expect(station('generate_2').getAttribute('aria-label')).toMatch(
        /^Traducir, LLM, Generar texto, \d+ problemas?$/,
      ),
    );
    // Stations are reachable with Tab.
    expect(station('generate_1').tabIndex).toBe(0);
  });

  it('puts every station in the tab order, in the order of the plan', async () => {
    await ready();
    // jsdom hides a node until React Flow measures it, so user-event cannot Tab through them; the
    // order and the tab stops are what the browser uses.
    const stops = [...document.querySelectorAll<HTMLElement>('.react-flow__node[tabindex="0"]')];
    expect(stops.map((stop) => stop.getAttribute('data-id'))).toEqual([
      'manual_1',
      'generate_1',
      'generate_2',
    ]);
    station('generate_1').focus();
    expect(document.activeElement).toBe(station('generate_1'));
  });

  it('selects a station with Enter, opens its panel and then enters it', async () => {
    const { user } = await ready();
    station('generate_1').focus();
    await user.keyboard('{Enter}');

    expect(await within(panel()).findByLabelText('Nombre del nodo')).toHaveProperty(
      'value',
      'Resumir',
    );
    expect(document.activeElement).toBe(station('generate_1'));
    expect(announcer().textContent).toMatch(/Resumir/);

    await user.keyboard('{Enter}');
    await waitFor(() => expect(panel().contains(document.activeElement)).toBe(true));
  });

  it('moves the selected station with the arrow keys and says so', async () => {
    const { user } = await ready();
    station('generate_1').focus();
    await user.keyboard('{Enter}');
    await within(panel()).findByLabelText('Nombre del nodo');
    await user.keyboard('{ArrowDown}');

    expect(await screen.findByText(/Sin guardar/)).toBeDefined();
    expect(await screen.findByText(/^Estación movida hacia abajo/)).toBeDefined();
  });

  it('connects two stations without dragging: Conectar, then the destination', async () => {
    const { user, server } = await ready();
    station('generate_1').focus();
    await user.keyboard('{Enter}');

    const connectButton = screen.getByRole('button', { name: 'Conectar' });
    connectButton.focus();
    await user.keyboard('{Enter}');
    expect(announcer().textContent).toMatch(/destino/i);

    station('generate_2').focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(announcer().textContent).toMatch(/Resumir.*Traducir/));
    expect(await screen.findByText('Sin problemas')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(server.saves).toHaveLength(1));
    const saved = server.saves[0]!.definition as typeof DRAFT;
    expect(saved.edges).toContainEqual(
      expect.objectContaining({ source: 'generate_1', sourceHandle: 'out', target: 'generate_2' }),
    );
  });

  it('leaves the connect mode with Escape, connecting nothing', async () => {
    const { user } = await ready();
    station('generate_1').focus();
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: 'Conectar' }));
    await user.keyboard('{Escape}');
    expect(announcer().textContent).toMatch(/cancelad/i);
    expect(screen.queryByText(/Sin guardar/)).toBeNull();
  });

  it('deletes the selected station only after confirming', async () => {
    const { user } = await ready();
    station('generate_2').focus();
    await user.keyboard('{Enter}');
    await user.keyboard('{Delete}');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/¿Eliminar «Traducir»\?/)).toBeDefined();
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(station('generate_2')).not.toBeNull();

    station('generate_2').focus();
    await user.keyboard('{Delete}');
    const again = await screen.findByRole('dialog');
    await user.click(within(again).getByRole('button', { name: 'Eliminar' }));

    await waitFor(() => expect(station('generate_2')).toBeNull());
    expect(announcer().textContent).toMatch(/Traducir/);
    expect(screen.getByText(/Sin guardar/)).toBeDefined();
  });
});
