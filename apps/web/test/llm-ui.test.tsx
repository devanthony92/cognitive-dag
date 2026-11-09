import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatCostUsd } from '../src/features/llm/format';
import { edge, FakeServer, mountEditor, node } from './editor-harness';
import {
  FakeEventSource,
  LLM_DEFINITION,
  ORG_ID,
  RUN_ID,
  WORKFLOW_ID,
  json,
  mount,
  problem,
  run,
  step,
} from './runs-harness';

const NO_FLAGS: Record<string, boolean> = {};
const DETAIL = `/orgs/${ORG_ID}/runs/${RUN_ID}`;
const HOME = `/orgs/${ORG_ID}`;
const USAGE_URL = /\/llm-usage\/today$/;
const FINISHED = '2026-10-30T12:00:05.000Z';

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('cost format', () => {
  it('reads micro-USD as legible dollars', () => {
    expect(formatCostUsd(0)).toMatch(/^0,00\sUS\$$/);
    expect(formatCostUsd(420)).toMatch(/^0,00042\sUS\$$/);
    expect(formatCostUsd(1_500_000)).toMatch(/^1,50\sUS\$$/);
  });
});

const usage = {
  calls: 2,
  model: 'gemini-test',
  inputTokens: 1200,
  outputTokens: 300,
  costMicroUsd: 420,
  repairs: 1,
};

const baseSteps = () => [
  step('inicio', { status: 'succeeded' }),
  step('alto', { status: 'succeeded' }),
  step('servicio_a', { status: 'succeeded' }),
];

const llmSteps = () => [
  ...baseSteps(),
  step('clasificar', {
    nodeType: 'llm.classify',
    status: 'succeeded',
    attempts: 1,
    llmUsage: usage,
  }),
];

const failedLlm = (error: {
  code: string;
  message: string;
  class: 'invalid_output' | 'budget_exhausted';
}) => [
  ...baseSteps(),
  step('clasificar', { nodeType: 'llm.classify', status: 'failed', attempts: 1, error }),
];

const openRun = (
  flags: Record<string, boolean>,
  steps = llmSteps(),
  total: unknown = { ...usage, model: undefined },
) =>
  mount(DETAIL, {
    flags,
    definition: LLM_DEFINITION,
    on: (url) => {
      if (/\/runs\/[0-9a-f-]{36}$/.test(url)) {
        return json({
          ...run({ status: 'succeeded', finishedAt: FINISHED }),
          llmUsage: total,
          steps,
          definition: LLM_DEFINITION,
        });
      }
      if (/\/steps\/clasificar\/io$/.test(url)) {
        return json({
          input: { text: 'hola' },
          output: { label: 'saludo', confidence: 0.87, note: '<img src=x onerror=alert(1)>' },
          truncated: false,
        });
      }
      return undefined;
    },
  });

const canvasNode = async () => {
  const found = await screen.findAllByText('Clasificar');
  return found.find((element) => !element.closest('[aria-label="Paleta de nodos"]'))!;
};

const stepPanel = () => screen.findByRole('complementary', { name: 'Detalle del nodo' });

describe('LLM step panel and run header (US1)', () => {
  it('shows model, tokens, cost, repairs and the estimated confidence', async () => {
    openRun(NO_FLAGS);
    fireEvent.click(await canvasNode());
    const panel = await stepPanel();

    const consumption = within(panel).getByRole('region', { name: 'Consumo LLM' });
    expect(within(consumption).getByText('gemini-test')).toBeDefined();
    expect(within(consumption).getByText('1200')).toBeDefined();
    expect(within(consumption).getByText('300')).toBeDefined();
    expect(within(consumption).getByText(/^0,00042\sUS\$$/)).toBeDefined();
    expect(within(consumption).getByText('1')).toBeDefined();
    expect(await within(panel).findByText('Confianza estimada:')).toBeDefined();
    expect(within(panel).getByText('87 %')).toBeDefined();
  });

  it('shows the total of the run in the header', async () => {
    openRun(NO_FLAGS);
    expect(await screen.findByText('Consumo LLM')).toBeDefined();
    expect(screen.getByText(/1200 entrada · 300 salida/)).toBeDefined();
  });

  it('prints the output as escaped text, never as HTML', async () => {
    openRun(NO_FLAGS);
    fireEvent.click(await canvasNode());
    const panel = await stepPanel();

    expect(await within(panel).findByText(/<img src=x onerror=alert\(1\)>/)).toBeDefined();
    expect(panel.querySelector('img')).toBeNull();
  });

  it('names the budget class in Spanish', async () => {
    openRun(
      NO_FLAGS,
      failedLlm({
        code: 'LLM_DAILY_BUDGET_EXHAUSTED',
        message: 'Daily budget exhausted.',
        class: 'budget_exhausted',
      }),
    );
    fireEvent.click(await canvasNode());
    const panel = await stepPanel();
    expect(within(panel).getByText(/Clase de error: Presupuesto agotado/)).toBeDefined();
  });

  it('names invalid output in Spanish', async () => {
    openRun(
      NO_FLAGS,
      failedLlm({ code: 'LLM_INVALID_OUTPUT', message: 'Bad.', class: 'invalid_output' }),
    );
    fireEvent.click(await canvasNode());
    const panel = await stepPanel();
    expect(within(panel).getByText(/Clase de error: Salida inválida/)).toBeDefined();
  });
});

describe('run button (US1)', () => {
  const EDITOR = `/orgs/${ORG_ID}/workflows/${WORKFLOW_ID}`;
  const runButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Ejecutar' });

  it('enables the run with LLM nodes', async () => {
    mount(EDITOR, { flags: NO_FLAGS, definition: LLM_DEFINITION });
    await waitFor(() => expect(runButton().disabled).toBe(false));
    expect(screen.queryByText(/desde F5/)).toBeNull();
  });
});

describe('"Consumo LLM de hoy" card (US3)', () => {
  const home = (flags: Record<string, boolean>, answer?: () => Response | Promise<Response>) =>
    mount(HOME, {
      flags,
      on: (url) => (USAGE_URL.test(url) && answer ? (answer() as Response) : undefined),
    });

  it('shows used of limit, a progress bar and the cost', async () => {
    home(NO_FLAGS, () =>
      json({
        date: '2026-10-30',
        tokensUsed: 125_000,
        tokensLimit: 500_000,
        costMicroUsd: 2_500_000,
      }),
    );
    expect(await screen.findByText('Consumo LLM de hoy')).toBeDefined();
    expect(await screen.findByText('125.000')).toBeDefined();
    expect(screen.getByText(/de 500\.000 tokens/)).toBeDefined();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25');
    expect(screen.getByText(/^2,50\sUS\$$/)).toBeDefined();
  });

  it('shows the loading state', async () => {
    home(NO_FLAGS, () => new Promise<Response>(() => {}));
    expect(await screen.findByText('Cargando consumo…')).toBeDefined();
  });

  it('says "Sin consumo hoy" when there is none', async () => {
    home(NO_FLAGS, () =>
      json({ date: '2026-10-30', tokensUsed: 0, tokensLimit: 500_000, costMicroUsd: 0 }),
    );
    expect(await screen.findByText('Sin consumo hoy')).toBeDefined();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows the error', async () => {
    home(NO_FLAGS, () => problem(503, 'SERVICE_UNAVAILABLE', 'No se pudo leer el consumo.'));
    expect(await screen.findByRole('alert')).toBeDefined();
  });
});

describe('editor: LLM nodes (US5)', () => {
  const draft = () => ({
    schemaVersion: 1,
    nodes: [
      node('manual_1', 'trigger.manual', 'Disparo', { inputSchema: [] }, 0),
      node(
        'clasificar_1',
        'llm.classify',
        'Clasificar',
        { text: 'hola', labels: ['a', 'b'], redactPii: false },
        300,
      ),
    ],
    edges: [edge('e1', 'manual_1', 'clasificar_1')],
  });
  const panel = () => screen.getByRole('complementary', { name: 'Panel lateral' });
  const server = (flags: Record<string, boolean>) => {
    const fake = new FakeServer(draft());
    fake.features = flags;
    return fake;
  };

  it('offers the PII switch and the warning', async () => {
    mountEditor(server(NO_FLAGS));
    fireEvent.click(await canvasNode());
    const toggle = await within(panel()).findByRole('switch', { name: 'Ocultar datos personales' });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    await waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(true));
    expect(
      within(panel()).getByText('No envíes datos reales: el proveedor puede usar el contenido.'),
    ).toBeDefined();
  });

  it('marks the LLM nodes of the palette as executable', async () => {
    mountEditor(server(NO_FLAGS));
    const palette = await screen.findByRole('complementary', { name: 'Paleta de nodos' });
    const classify = within(palette).getByRole('button', { name: /Clasificar/ });
    await waitFor(() => expect(within(classify).getByText('Ejecutable')).toBeDefined());
  });
});
