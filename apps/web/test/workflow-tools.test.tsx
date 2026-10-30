import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DagDefinitionSchema, validateDefinition } from '@cognitive-dag/dag-schema';
import { edge, FakeServer, mountEditor, node } from './editor-harness';

/** A diamond with every node on the same spot, as a user would leave it after a mess. */
const messy = () => ({
  schemaVersion: 1,
  nodes: [
    node('manual_1', 'trigger.manual', 'Disparo', { inputSchema: [] }, 10, 10),
    node(
      'generate_a',
      'llm.generate',
      'Rama A',
      { instruction: 'A', language: 'es', maxLength: 10 },
      10,
      10,
    ),
    node(
      'generate_b',
      'llm.generate',
      'Rama B',
      { instruction: 'B', language: 'es', maxLength: 10 },
      10,
      10,
    ),
    node('merge_1', 'logic.merge', 'Unir', { strategy: 'all' }, 10, 10),
  ],
  edges: [
    edge('e1', 'manual_1', 'generate_a'),
    edge('e2', 'manual_1', 'generate_b'),
    edge('e3', 'generate_a', 'merge_1'),
    edge('e4', 'generate_b', 'merge_1'),
  ],
});

interface Download {
  name: string;
  text: Promise<string>;
}
let downloads: Download[] = [];

beforeEach(() => {
  downloads = [];
  const blobs = new Map<string, Blob>();
  let counter = 0;
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: (blob: Blob) => {
      const url = `blob:test/${(counter += 1)}`;
      blobs.set(url, blob);
      return url;
    },
    revokeObjectURL: () => {},
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    const blob = blobs.get(this.href);
    if (blob) downloads.push({ name: this.download, text: blob.text() });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('editor: auto layout (US6)', () => {
  it('lays the nodes out in layers from left to right without touching the logic', async () => {
    const server = new FakeServer(messy());
    const { user } = mountEditor(server);
    await screen.findByText('Rama A');
    expect(screen.queryByText('Sin guardar')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Ordenar' }));
    expect(screen.getByText('Sin guardar')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(server.saves).toHaveLength(1));
    const saved = server.saves[0]?.definition as ReturnType<typeof messy>;
    const x = (id: string) => saved.nodes.find((n) => n.id === id)?.position.x as number;
    const y = (id: string) => saved.nodes.find((n) => n.id === id)?.position.y as number;

    for (const e of saved.edges) expect(x(e.source)).toBeLessThan(x(e.target));
    expect(x('generate_a')).toBe(x('generate_b'));
    expect(y('generate_a')).not.toBe(y('generate_b'));

    const strip = (d: ReturnType<typeof messy>) => ({
      ...d,
      nodes: d.nodes.map(({ position: _p, ...rest }) => rest),
    });
    expect(strip(saved)).toEqual(strip(messy()));
    expect(validateDefinition(saved).valid).toBe(true);
  });

  it('is not offered to a viewer', async () => {
    mountEditor(new FakeServer(messy()), 'viewer');
    await screen.findByText('Rama A');
    expect(screen.queryByRole('button', { name: 'Ordenar' })).toBeNull();
  });

  it('is disabled while there is nothing to arrange', async () => {
    mountEditor(new FakeServer({ schemaVersion: 1, nodes: [], edges: [] }));
    expect(await screen.findByRole('button', { name: 'Ordenar' })).toHaveProperty('disabled', true);
  });
});

describe('editor: export (US6)', () => {
  it('downloads the draft as a JSON file that is valid against the schema', async () => {
    const { user } = mountEditor(new FakeServer(messy()));
    await screen.findByText('Rama A');

    await user.click(screen.getByRole('button', { name: 'Exportar JSON' }));

    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.name).toBe('soporte-tecnico.json');
    const parsed: unknown = JSON.parse(await (downloads[0] as Download).text);
    expect(DagDefinitionSchema.safeParse(parsed).success).toBe(true);
    expect(validateDefinition(parsed).valid).toBe(true);
    expect(parsed).toEqual(messy());
  });

  it('exports what is on screen, including changes not saved yet', async () => {
    const { user } = mountEditor(new FakeServer(messy()));
    fireEvent.click(await screen.findByText('Rama A'));
    const label = await screen.findByLabelText('Nombre del nodo');
    await user.clear(label);
    await user.type(label, 'Rama nueva');
    await user.click(screen.getByRole('button', { name: 'Exportar JSON' }));

    expect(await (downloads[0] as Download).text).toContain('Rama nueva');
  });

  it('is available to a viewer', async () => {
    const { user } = mountEditor(new FakeServer(messy()), 'viewer');
    await screen.findByText('Rama A');
    await user.click(screen.getByRole('button', { name: 'Exportar JSON' }));
    expect(downloads).toHaveLength(1);
  });

  it('exports a published version from the history', async () => {
    const version = {
      number: 2,
      note: null,
      publishedAt: '2026-10-29T10:30:00.000Z',
      publishedBy: { id: '0192f0a0-0000-7000-8000-000000000001', name: 'Ana' },
      nodeCount: 4,
      edgeCount: 4,
      nodeTypes: ['trigger.manual'],
      active: true,
    };
    const published = {
      ...messy(),
      nodes: messy().nodes.slice(0, 2),
      edges: messy().edges.slice(0, 1),
    };
    const { user } = mountEditor(new FakeServer(messy(), 3, [version], { 2: published }));
    await screen.findByText('Rama A');
    await user.click(screen.getByRole('tab', { name: 'Versiones' }));
    await user.click(await screen.findByRole('button', { name: 'Exportar versión 2 como JSON' }));

    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]?.name).toBe('soporte-tecnico-v2.json');
    expect(JSON.parse(await (downloads[0] as Download).text)).toEqual(published);
    expect(
      within(screen.getByRole('complementary', { name: 'Panel lateral' })).getByText('Versión 2'),
    ).toBeDefined();
  });
});
