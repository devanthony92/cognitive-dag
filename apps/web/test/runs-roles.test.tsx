import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { OrganizationRun } from '@cognitive-dag/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFINITION,
  FakeEventSource,
  ORG_ID,
  RUN_ID,
  WORKFLOW_ID,
  json,
  mount,
  run,
  step,
} from './runs-harness';

/**
 * F8 US2 (ADR-0082): only owner and editor start, cancel and rerun runs. The viewer sees the same
 * buttons disabled, with the reason on screen; the API still decides (403).
 */
const REASON = 'Tu rol no permite ejecutar workflows.';
const EDITOR = `/orgs/${ORG_ID}/workflows/${WORKFLOW_ID}`;
const DETAIL = `/orgs/${ORG_ID}/runs/${RUN_ID}`;
const LIST = `/orgs/${ORG_ID}/runs`;
const FINISHED = '2026-10-30T12:00:05.000Z';
const RESILIENCE = { 'resilience-enabled': true };

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// The first mount of a file loads the route chunks: allow it more than the default second.
const button = (name: string) =>
  screen.findByRole<HTMLButtonElement>('button', { name }, { timeout: 5000 });

const detail = (overrides = {}) =>
  json({
    ...run(overrides),
    steps: [
      step('inicio', { status: 'succeeded' }),
      step('alto', { status: 'succeeded' }),
      step('servicio_a', { status: 'failed' }),
    ],
    definition: DEFINITION,
  });

const isRunDetail = (url: string, init: RequestInit) =>
  /\/runs\/[0-9a-f-]{36}$/.test(url) && (init.method ?? 'GET') === 'GET';

describe.each([
  ['owner', true],
  ['editor', true],
  ['viewer', false],
] as const)('%s on the run button (US2)', (role, allowed) => {
  it(allowed ? 'can run' : 'sees "Ejecutar" disabled with the reason', async () => {
    mount(EDITOR, { role });
    const run = await button('Ejecutar');
    if (allowed) {
      await vi.waitFor(() => expect(run.disabled).toBe(false));
      expect(screen.queryByText(REASON)).toBeNull();
    } else {
      expect(run.disabled).toBe(true);
      expect(screen.getByText(REASON)).toBeDefined();
      expect(run.getAttribute('aria-describedby')).toBeTruthy();
    }
  });
});

describe.each([
  ['owner', true],
  ['editor', true],
  ['viewer', false],
] as const)('%s on the run detail (US2)', (role, allowed) => {
  it(`${allowed ? 'can' : 'cannot'} cancel a run in progress`, async () => {
    mount(DETAIL, {
      role,
      flags: RESILIENCE,
      on: (url, init) => (isRunDetail(url, init) ? detail({ status: 'running' }) : undefined),
    });
    const cancel = await button('Cancelar');
    expect(cancel.disabled).toBe(!allowed);
    expect(screen.queryByText(REASON) !== null).toBe(!allowed);
  });

  it(`${allowed ? 'can' : 'cannot'} rerun a finished run, whole or from a node`, async () => {
    mount(DETAIL, {
      role,
      flags: RESILIENCE,
      on: (url, init) =>
        isRunDetail(url, init) ? detail({ status: 'failed', finishedAt: FINISHED }) : undefined,
    });
    const rerun = await button('Reejecutar');
    expect(rerun.disabled).toBe(!allowed);
    expect(screen.queryByText(REASON) !== null).toBe(!allowed);

    const graph = await screen.findByLabelText('Grafo de la ejecución');
    fireEvent.click(await within(graph).findByText('Servicio A'));
    const fromNode = await button('Reejecutar desde aquí');
    expect(fromNode.disabled).toBe(!allowed);
  });
});

describe.each([
  ['owner', true],
  ['editor', true],
  ['viewer', false],
] as const)('%s on the organization runs list (US2)', (role, allowed) => {
  it(`${allowed ? 'can' : 'cannot'} rerun a failed run`, async () => {
    const failed: OrganizationRun = {
      ...run({ status: 'failed', finishedAt: FINISHED }),
      workflowName: 'Soporte técnico',
      failedNodeId: 'servicio_a',
    };
    mount(LIST, {
      role,
      flags: RESILIENCE,
      on: (url) =>
        /\/organizations\/[0-9a-f-]{36}\/runs\?/.test(url)
          ? json({ items: [failed], nextCursor: null })
          : url.endsWith('/workflows')
            ? json([])
            : undefined,
    });
    expect((await button('Reejecutar')).disabled).toBe(!allowed);
    expect((await button('Reejecutar desde el nodo fallido')).disabled).toBe(!allowed);
    expect(screen.queryAllByText(REASON).length > 0).toBe(!allowed);
  });
});
