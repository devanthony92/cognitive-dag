import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { edge, FakeServer, mountEditor, node } from './editor-harness';

const draft = () => ({
  schemaVersion: 1,
  nodes: [
    node(
      'manual_1',
      'trigger.manual',
      'Disparo',
      {
        inputSchema: [
          { name: 'texto', type: { kind: 'string' } },
          { name: 'edad', type: { kind: 'number' } },
        ],
      },
      0,
    ),
    node(
      'classify_1',
      'llm.classify',
      'Sentimiento',
      { text: 'Clasifica el mensaje', labels: ['feliz', 'enojado'] },
      300,
    ),
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
    node(
      'http_1',
      'http.request',
      'Avisar',
      { method: 'POST', url: 'https://example.com/avisos', headers: {}, body: '' },
      900,
    ),
    node(
      'generate_1',
      'llm.generate',
      'Resumir',
      { instruction: 'Escribe un resumen.', language: 'es', maxLength: 100 },
      300,
      200,
    ),
  ],
  edges: [
    edge('e1', 'manual_1', 'classify_1'),
    edge('e2', 'classify_1', 'condition_1'),
    edge('e3', 'condition_1', 'http_1', 'true'),
    edge('e4', 'manual_1', 'generate_1'),
  ],
});

const panel = () => screen.getByRole('complementary', { name: 'Panel lateral' });
const optionsOf = (select: HTMLElement) =>
  [...select.querySelectorAll('option')].map((o) => o.textContent ?? '');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('editor: references in templates (US4)', () => {
  it('offers only fields of earlier nodes, with their type', async () => {
    mountEditor(new FakeServer(draft()));
    fireEvent.click(await screen.findByText('Avisar'));
    const select = await within(panel()).findByLabelText('Insertar referencia en Cuerpo');

    const texts = optionsOf(select);
    expect(texts).toContain('label · enum<feliz | enojado>');
    expect(texts).toContain('confidence · number');
    expect(texts).toContain('texto · string');
    // Not itself, and not a node that is not upstream of it.
    expect(select.innerHTML).not.toContain('http_1');
    expect(select.innerHTML).not.toContain('generate_1');
  });

  it('offers no fields to the node that follows nothing', async () => {
    mountEditor(new FakeServer(draft()));
    fireEvent.click(await screen.findByText('Disparo'));
    // The trigger has no templatable text, so there is no insertion control at all.
    expect(within(panel()).queryByLabelText(/Insertar referencia/)).toBeNull();
  });

  it('inserts the marker at the caret, shows it as a chip and keeps the draft valid', async () => {
    const { user } = mountEditor(new FakeServer(draft()));
    fireEvent.click(await screen.findByText('Sentimiento'));
    const text = await within(panel()).findByLabelText('Texto');
    await user.clear(text);
    await user.type(text, 'Mensaje: ');
    await user.selectOptions(
      within(panel()).getByLabelText('Insertar referencia en Texto'),
      'nodes.manual_1.output.texto',
    );

    expect(text).toHaveProperty('value', 'Mensaje: {{nodes.manual_1.output.texto}}');
    const chips = within(panel()).getByRole('list', { name: 'Referencias de Texto' });
    expect(within(chips).getByText('Disparo › texto')).toBeDefined();
    await waitFor(() => expect(screen.getByText('Sin problemas')).toBeDefined(), { timeout: 1500 });
  });

  it('removes the marker from the text when its chip is closed', async () => {
    const { user } = mountEditor(new FakeServer(draft()));
    fireEvent.click(await screen.findByText('Sentimiento'));
    await user.selectOptions(
      await within(panel()).findByLabelText('Insertar referencia en Texto'),
      'nodes.manual_1.output.edad',
    );
    expect(within(panel()).getByLabelText('Texto')).toHaveProperty(
      'value',
      'Clasifica el mensaje{{nodes.manual_1.output.edad}}',
    );

    await user.click(
      within(panel()).getByRole('button', { name: 'Quitar referencia Disparo › edad' }),
    );
    expect(within(panel()).getByLabelText('Texto')).toHaveProperty('value', 'Clasifica el mensaje');
  });

  it('marks a chip as invalid when its node is gone, and the validator says why', async () => {
    const broken = draft();
    broken.nodes[3] = node(
      'http_1',
      'http.request',
      'Avisar',
      {
        method: 'POST',
        url: 'https://example.com/avisos',
        headers: {},
        body: 'Ver {{nodes.borrado_1.output.label}}',
      },
      900,
    );
    mountEditor(new FakeServer(broken));
    fireEvent.click(await screen.findByText('Avisar'));

    const chips = await within(panel()).findByRole('list', { name: 'Referencias de Cuerpo' });
    const chip = within(chips).getAllByRole('listitem')[0] as HTMLElement;
    expect(chip.getAttribute('data-invalid')).toBe('true');
    expect(chip.textContent).toContain('no válida');
    expect(await within(panel()).findByText(/El nodo «borrado_1» no existe/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Publicar' })).toHaveProperty('disabled', true);
  });

  it('keeps text with markers literal in a field that is not a template', async () => {
    const literal = draft();
    literal.nodes[1] = node(
      'classify_1',
      'llm.classify',
      'Sentimiento',
      {
        text: 'Clasifica',
        labels: ['{{nodes.nada.output.x}}', 'otra'],
      },
      300,
    );
    mountEditor(new FakeServer(literal));
    fireEvent.click(await screen.findByText('Sentimiento'));

    await waitFor(() => expect(screen.getByText('Sin problemas')).toBeDefined(), { timeout: 1500 });
  });
});

describe('editor: condition builder (US4)', () => {
  const condition = () => within(panel()).getByRole('group', { name: 'Condición' });

  it('builds label = "enojado" Y confidence > 0.8 and stores it as a typed tree', async () => {
    const server = new FakeServer(draft());
    const { user } = mountEditor(server);
    fireEvent.click(await screen.findByText('Decidir'));
    await within(panel()).findByRole('group', { name: 'Condición' });

    await user.selectOptions(screen.getByLabelText('Operación de Condición'), 'and');
    // The first comparison is the old one, now inside the group.
    await user.selectOptions(screen.getByLabelText('Condición 1 · izquierda: origen'), 'ref');
    await user.selectOptions(
      screen.getByLabelText('Condición 1 · izquierda: campo'),
      'nodes.classify_1.output.label',
    );
    // The literal on the right followed the type of the field: text, with the labels to pick.
    await user.selectOptions(screen.getByLabelText('Condición 1 · derecha: valor'), 'enojado');

    await user.click(screen.getByRole('button', { name: 'Agregar comparación a Condición' }));
    await user.selectOptions(screen.getByLabelText('Operación de Condición 2'), 'gt');
    await user.selectOptions(
      screen.getByLabelText('Condición 2 · izquierda: campo'),
      'nodes.classify_1.output.confidence',
    );
    const value = screen.getByLabelText('Condición 2 · derecha: valor');
    await user.clear(value);
    await user.type(value, '0.8');

    await waitFor(() => expect(screen.getByText('Sin problemas')).toBeDefined(), { timeout: 1500 });
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(server.saves).toHaveLength(1));

    const saved = server.saves[0]?.definition as { nodes: Array<{ id: string; config: unknown }> };
    expect(saved.nodes.find((n) => n.id === 'condition_1')?.config).toEqual({
      condition: {
        op: 'and',
        operands: [
          {
            op: 'eq',
            left: { kind: 'ref', path: 'nodes.classify_1.output.label' },
            right: { kind: 'literal', type: 'string', value: 'enojado' },
          },
          {
            op: 'gt',
            left: { kind: 'ref', path: 'nodes.classify_1.output.confidence' },
            right: { kind: 'literal', type: 'number', value: 0.8 },
          },
        ],
      },
    });
  });

  it('offers only numbers (or dates) for an ordering comparison', async () => {
    const { user } = mountEditor(new FakeServer(draft()));
    fireEvent.click(await screen.findByText('Decidir'));
    await user.selectOptions(await screen.findByLabelText('Operación de Condición'), 'gt');
    await user.selectOptions(screen.getByLabelText('Condición · izquierda: origen'), 'ref');

    const texts = optionsOf(screen.getByLabelText('Condición · izquierda: campo'));
    expect(texts).toContain('confidence · number');
    expect(texts).toContain('edad · number');
    expect(texts.some((t) => t.startsWith('label'))).toBe(false);
    expect(texts.some((t) => t.startsWith('texto'))).toBe(false);
  });

  it('wraps in NO and unwraps again, and never loses the comparison', async () => {
    const { user } = mountEditor(new FakeServer(draft()));
    fireEvent.click(await screen.findByText('Decidir'));
    await user.selectOptions(await screen.findByLabelText('Operación de Condición'), 'not');

    expect(screen.getByRole('group', { name: 'Condición 1' })).toBeDefined();
    await user.selectOptions(screen.getByLabelText('Operación de Condición'), 'eq');
    expect(screen.queryByRole('group', { name: 'Condición 1' })).toBeNull();
    expect(screen.getByLabelText('Condición · izquierda: valor')).toBeDefined();
  });

  it('stops adding groups at the depth limit', async () => {
    const { user } = mountEditor(new FakeServer(draft()));
    fireEvent.click(await screen.findByText('Decidir'));
    await user.selectOptions(await screen.findByLabelText('Operación de Condición'), 'and');

    // Each new group is the second child of the previous one: 2, 2.2, 2.2.2.
    for (const parent of ['Condición', 'Condición 2', 'Condición 2.2']) {
      await user.click(screen.getByRole('button', { name: `Agregar grupo a ${parent}` }));
    }

    // 2.2.2 sits at level 4 and already holds a comparison at level 5: no room for another level.
    expect(screen.getByRole('button', { name: 'Agregar grupo a Condición 2.2.2' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(
      screen.getByRole('button', { name: 'Agregar comparación a Condición 2.2.2' }),
    ).toHaveProperty('disabled', false);
  });

  it('stops adding at 20 operations', async () => {
    const { user } = mountEditor(new FakeServer(draft()));
    fireEvent.click(await screen.findByText('Decidir'));
    await user.selectOptions(await screen.findByLabelText('Operación de Condición'), 'and');

    const add = screen.getByRole('button', { name: 'Agregar comparación a Condición' });
    for (let i = 0; i < 25 && !(add as HTMLButtonElement).disabled; i++) await user.click(add);

    expect(add).toHaveProperty('disabled', true);
    // The group itself plus its 19 comparisons.
    expect(within(condition()).getAllByRole('group', { name: /^Condición \d+$/ })).toHaveLength(19);
  });

  it('keeps each operand readable: selectors wrap, the value gets its own full-width line', async () => {
    const { user } = mountEditor(new FakeServer(draft()));
    fireEvent.click(await screen.findByText('Decidir'));
    await user.selectOptions(await screen.findByLabelText('Operación de Condición'), 'and');

    const value = screen.getByLabelText('Condición 1 · derecha: valor');
    const row = value.closest('[data-part="value"]') as HTMLElement;
    const selectors = row.previousElementSibling as HTMLElement;
    // The value is never in the same flex line as origin and type, so it cannot be squeezed.
    expect(row.parentElement).toBe(selectors.parentElement);
    expect(selectors.className).toContain('flex-wrap');
    expect(selectors.contains(value)).toBe(false);
    expect(within(selectors).getByLabelText('Condición 1 · derecha: origen')).toBeDefined();
    expect(within(selectors).getByLabelText('Condición 1 · derecha: tipo')).toBeDefined();
    // Nested groups indent by a few pixels, not by a third of the panel.
    expect(
      screen.getByRole('group', { name: 'Condición 1' }).parentElement?.parentElement?.className,
    ).toContain('pl-2');
  });

  it('does not call a condition valid while an operand is still empty', async () => {
    const { user } = mountEditor(new FakeServer(draft()));
    fireEvent.click(await screen.findByText('Decidir'));
    await user.selectOptions(await screen.findByLabelText('Operación de Condición'), 'eq');
    await user.selectOptions(screen.getByLabelText('Condición · izquierda: origen'), 'ref');
    await user.selectOptions(
      screen.getByLabelText('Condición · izquierda: campo'),
      'nodes.classify_1.output.label',
    );
    await user.selectOptions(screen.getByLabelText('Condición · derecha: valor'), '');

    expect(
      await within(panel()).findByText('Elige un valor para la derecha.', undefined, {
        timeout: 1500,
      }),
    ).toBeDefined();
    expect(screen.queryByText('Sin problemas')).toBeNull();

    await user.selectOptions(screen.getByLabelText('Condición · izquierda: campo'), '');
    expect(
      await within(panel()).findByText('Elige el campo de la izquierda.', undefined, {
        timeout: 1500,
      }),
    ).toBeDefined();
  });

  it('shows a reference to a deleted node as invalid instead of dropping it', async () => {
    const broken = draft();
    broken.nodes[2] = node(
      'condition_1',
      'logic.condition',
      'Decidir',
      {
        condition: {
          op: 'eq',
          left: { kind: 'ref', path: 'nodes.borrado_1.output.label' },
          right: { kind: 'literal', type: 'string', value: 'enojado' },
        },
      },
      600,
    );
    mountEditor(new FakeServer(broken));
    fireEvent.click(await screen.findByText('Decidir'));

    const field = await screen.findByLabelText('Condición · izquierda: campo');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(within(field).getByText('⚠ nodes.borrado_1.output.label (no válida)')).toBeDefined();
    expect(await within(panel()).findAllByText(/El nodo «borrado_1» no existe/)).not.toHaveLength(
      0,
    );
  });
});

describe('editor: renaming a node id (US4)', () => {
  it('rewrites the references and keeps the draft valid', async () => {
    const withRefs = draft();
    withRefs.nodes[3] = node(
      'http_1',
      'http.request',
      'Avisar',
      {
        method: 'POST',
        url: 'https://example.com/avisos',
        headers: {},
        body: 'Etiqueta: {{nodes.classify_1.output.label}}',
      },
      900,
    );
    withRefs.nodes[2] = node(
      'condition_1',
      'logic.condition',
      'Decidir',
      {
        condition: {
          op: 'eq',
          left: { kind: 'ref', path: 'nodes.classify_1.output.label' },
          right: { kind: 'literal', type: 'string', value: 'enojado' },
        },
      },
      600,
    );
    const server = new FakeServer(withRefs);
    const { user } = mountEditor(server);
    await waitFor(() => expect(screen.getByText('Sin problemas')).toBeDefined());

    fireEvent.click(screen.getByText('Sentimiento'));
    const id = await within(panel()).findByLabelText('Identificador');
    await user.clear(id);
    await user.type(id, 'sentimiento{Enter}');

    await waitFor(() =>
      expect(within(panel()).getByLabelText('Identificador')).toHaveProperty(
        'value',
        'sentimiento',
      ),
    );
    await waitFor(() => expect(screen.getByText('Sin problemas')).toBeDefined(), { timeout: 1500 });
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(server.saves).toHaveLength(1));

    const saved = JSON.stringify(server.saves[0]?.definition);
    expect(saved).toContain('{{nodes.sentimiento.output.label}}');
    expect(saved).toContain('nodes.sentimiento.output.label');
    expect(saved).not.toContain('classify_1');
  });

  it('explains in Spanish why an id cannot be used, and changes nothing', async () => {
    const { user } = mountEditor(new FakeServer(draft()));
    fireEvent.click(await screen.findByText('Sentimiento'));
    const id = await within(panel()).findByLabelText('Identificador');

    await user.clear(id);
    await user.type(id, 'Mal Id{Enter}');
    expect(await within(panel()).findByText(/debe empezar con una letra minúscula/)).toBeDefined();

    await user.clear(id);
    await user.type(id, 'http_1{Enter}');
    expect(
      await within(panel()).findByText(/Ya existe un nodo con el identificador «http_1»/),
    ).toBeDefined();
    expect(document.querySelector('[data-id="classify_1"]')).not.toBeNull();
  });
});
