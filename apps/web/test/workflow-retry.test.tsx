import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { edge, FakeServer, mountEditor, node } from './editor-harness';

const draft = (retry?: Record<string, unknown>) => ({
  schemaVersion: 1,
  nodes: [
    node('manual_1', 'trigger.manual', 'Disparo', { inputSchema: [] }, 0),
    {
      ...node(
        'service_1',
        'mock.service',
        'Cobrar',
        { latencyMs: 0, failureRate: 0, failureKind: 'transient' },
        300,
      ),
      ...(retry ? { retry } : {}),
    },
    node(
      'condition_1',
      'logic.condition',
      'Decidir',
      {
        condition: {
          op: 'eq',
          left: { kind: 'literal', type: 'boolean', value: true },
          right: { kind: 'literal', type: 'boolean', value: true },
        },
      },
      600,
    ),
  ],
  edges: [edge('e1', 'manual_1', 'service_1'), edge('e2', 'service_1', 'condition_1')],
});

const panel = () => screen.getByRole('complementary', { name: 'Panel lateral' });

const serverWith = (retry?: Record<string, unknown>, flags = { 'resilience-enabled': true }) => {
  const server = new FakeServer(draft(retry));
  server.features = flags;
  return server;
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('editor: retry settings (US2)', () => {
  it('shows the section on a node with an effect, with the defaults of its type as placeholders', async () => {
    mountEditor(serverWith());
    fireEvent.click(await screen.findByText('Cobrar'));
    const section = await within(panel()).findByRole('region', { name: 'Reintentos' });

    const attempts = within(section).getByLabelText('Intentos máximos');
    expect(attempts).toHaveProperty('placeholder', '3');
    expect(attempts).toHaveProperty('value', '');
    expect(within(section).getByLabelText('Tiempo máximo por intento (s)')).toHaveProperty(
      'placeholder',
      '30',
    );
    expect(within(section).getByLabelText('Espera inicial (ms)')).toHaveProperty(
      'placeholder',
      '1000',
    );
    expect(within(section).getByText('Por defecto 3. Entre 1 y 10.')).toBeDefined();
  });

  it('is hidden on logic nodes and triggers', async () => {
    mountEditor(serverWith());
    fireEvent.click(await screen.findByText('Decidir'));
    await within(panel()).findByLabelText('Nombre del nodo');
    expect(within(panel()).queryByRole('region', { name: 'Reintentos' })).toBeNull();

    fireEvent.click(screen.getByText('Disparo'));
    await within(panel()).findByText('Inicia el workflow a mano', { exact: false });
    expect(within(panel()).queryByRole('region', { name: 'Reintentos' })).toBeNull();
  });

  it('does not exist with resilience-enabled off', async () => {
    mountEditor(serverWith(undefined, {} as never));
    fireEvent.click(await screen.findByText('Cobrar'));
    await within(panel()).findByLabelText('Nombre del nodo');
    expect(within(panel()).queryByRole('region', { name: 'Reintentos' })).toBeNull();
  });

  it('saves what is typed in the node and leaves the rest to the defaults', async () => {
    const server = serverWith();
    const { user } = mountEditor(server);
    fireEvent.click(await screen.findByText('Cobrar'));
    const section = await within(panel()).findByRole('region', { name: 'Reintentos' });
    await user.type(within(section).getByLabelText('Intentos máximos'), '5');
    await user.type(within(section).getByLabelText('Espera inicial (ms)'), '2000');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(server.saves.length).toBeGreaterThan(0));
    const saved = server.saves.at(-1)?.definition as ReturnType<typeof draft>;
    expect(saved.nodes.find((n) => n.id === 'service_1')).toMatchObject({
      retry: { maxAttempts: 5, initialIntervalMs: 2000 },
    });
  });

  it('goes back to the defaults when the fields are emptied', async () => {
    const server = serverWith({ maxAttempts: 4 });
    const { user } = mountEditor(server);
    fireEvent.click(await screen.findByText('Cobrar'));
    const attempts = await within(panel()).findByLabelText('Intentos máximos');
    expect(attempts).toHaveProperty('value', '4');
    await user.clear(attempts);
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(server.saves.length).toBeGreaterThan(0));
    const saved = server.saves.at(-1)?.definition as ReturnType<typeof draft>;
    expect(saved.nodes.find((n) => n.id === 'service_1')).not.toHaveProperty('retry');
  });

  it('marks the field that is out of range, in Spanish, and clears it when fixed', async () => {
    const { user } = mountEditor(serverWith());
    fireEvent.click(await screen.findByText('Cobrar'));
    const attempts = await within(panel()).findByLabelText('Intentos máximos');
    await user.type(attempts, '11');

    await waitFor(() => expect(attempts.getAttribute('aria-invalid')).toBe('true'), {
      timeout: 1500,
    });
    expect(within(panel()).getByText(/entre 1 y 10/i)).toBeDefined();

    await user.clear(attempts);
    await user.type(attempts, '10');
    await waitFor(() => expect(attempts.getAttribute('aria-invalid')).toBe('false'), {
      timeout: 1500,
    });
  });

  it('shows the saved values and leaves them read-only for a viewer', async () => {
    const server = serverWith({ maxAttempts: 4, timeoutSeconds: 60 });
    mountEditor(server, 'viewer');
    fireEvent.click(await screen.findByText('Cobrar'));
    const section = await within(panel()).findByRole('region', { name: 'Reintentos' });
    expect(within(section).getByLabelText('Intentos máximos')).toHaveProperty('value', '4');
    expect(within(section).getByLabelText('Tiempo máximo por intento (s)')).toHaveProperty(
      'value',
      '60',
    );
    // Disabled through the fieldset of the panel.
    expect(within(section).getByLabelText('Intentos máximos').matches(':disabled')).toBe(true);
  });
});
