import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { edge, FakeServer, mountEditor, node } from './editor-harness';

const draftBy = (author: string, label: string) => ({
  schemaVersion: 1,
  nodes: [
    node('manual_1', 'trigger.manual', 'Disparo', { inputSchema: [] }),
    node(
      'generate_1',
      'llm.generate',
      label,
      { instruction: `Escrito por ${author}.`, language: 'es', maxLength: 100 },
      300,
    ),
  ],
  edges: [edge('e1', 'manual_1', 'generate_1')],
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('editor: concurrent editing (US5)', () => {
  it('warns the second session instead of overwriting, and offers to reload the saved draft', async () => {
    // Ana and Marta open revision 3. Marta saves first: the server moves to revision 4.
    const server = new FakeServer(draftBy('Ana', 'Resumir'));
    const { user } = mountEditor(server);
    fireEvent.click(await screen.findByText('Resumir'));

    const label = await screen.findByLabelText('Nombre del nodo');
    await user.clear(label);
    await user.type(label, 'Cambio de Ana');
    server.saveElsewhere(draftBy('Marta', 'Cambio de Marta'));

    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    const dialog = await screen.findByRole('dialog', { name: 'El borrador cambió en otra sesión' });
    expect(server.saves).toHaveLength(1);
    expect(server.saves[0]?.ifMatch).toBe('"3"');
    expect(server.draft).toEqual(draftBy('Marta', 'Cambio de Marta'));
    expect(within(dialog).getByText(/no se aplicó para no pisar su trabajo/)).toBeDefined();

    await user.click(within(dialog).getByRole('button', { name: 'Recargar borrador' }));

    // Ana now sees what Marta saved, with nothing pending.
    expect(await screen.findByText('Cambio de Marta')).toBeDefined();
    expect(screen.queryByText('Cambio de Ana')).toBeNull();
    expect(screen.queryByText('Sin guardar')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();

    // The next save carries the new revision and goes through.
    fireEvent.click(screen.getByText('Cambio de Marta'));
    const again = await screen.findByLabelText('Nombre del nodo');
    await user.clear(again);
    await user.type(again, 'Revisado por Ana');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(server.saves).toHaveLength(2));
    expect(server.saves[1]?.ifMatch).toBe('"4"');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lets the user keep editing: nothing is lost and the conflict stays visible', async () => {
    const server = new FakeServer(draftBy('Ana', 'Resumir'));
    const { user } = mountEditor(server);
    fireEvent.click(await screen.findByText('Resumir'));
    const label = await screen.findByLabelText('Nombre del nodo');
    await user.clear(label);
    await user.type(label, 'Cambio de Ana');
    server.saveElsewhere(draftBy('Marta', 'Cambio de Marta'));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    const dialog = await screen.findByRole('dialog', { name: 'El borrador cambió en otra sesión' });
    await user.click(within(dialog).getByRole('button', { name: 'Seguir editando' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getAllByText('Cambio de Ana').length).toBeGreaterThan(0);
    expect(screen.getByText('Sin guardar')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Recargar' })).toBeDefined();
    expect(server.draft).toEqual(draftBy('Marta', 'Cambio de Marta'));
  });

  it('does not show the dialog for other failures', async () => {
    const server = new FakeServer(draftBy('Ana', 'Resumir'));
    const { user, fetchMock } = mountEditor(server);
    fireEvent.click(await screen.findByText('Resumir'));
    const label = await screen.findByLabelText('Nombre del nodo');
    await user.type(label, '!');

    const original = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      /\/draft$/.test(url)
        ? Promise.resolve(
            new Response(
              JSON.stringify({
                status: 413,
                title: 'Content Too Large',
                detail: 'La definición supera el límite.',
                code: 'LIMIT_EXCEEDED',
                correlationId: '0b5f7f5e-3c1a-4d57-9a53-7d9a2a2d6c11',
              }),
              { status: 413, headers: { 'Content-Type': 'application/problem+json' } },
            ),
          )
        : (original as (u: string, i?: RequestInit) => Promise<Response>)(url, init),
    );
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('La definición supera el límite.')).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
