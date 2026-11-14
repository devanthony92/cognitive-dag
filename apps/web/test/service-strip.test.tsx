/**
 * The service strip of the run list (F10, FR-028, T058; research R15): one station per step with its
 * state glyph, «+N» when there are many, the space held while the detail arrives, and only the station
 * that changes is redrawn. The list carries no steps, so the strip loads the detail of each visible row
 * on demand: never more than 8 at once, and never before the row is on screen.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunDetail } from '@cognitive-dag/contracts';
import {
  createLimiter,
  LazyServiceStrip,
  ServiceStrip,
  StripStationMark,
  stripStations,
  type StripStation,
} from '../src/components/station/ServiceStrip';
import { DEFINITION, json, ORG_ID, run, RUN_ID, step } from './runs-harness';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const at = (nodeId: string, state: StripStation['state'], stateLabel: string): StripStation => ({
  nodeId,
  label: nodeId,
  state,
  stateLabel,
});

const marks = () => [...document.querySelectorAll('[data-strip-station]')] as HTMLElement[];

describe('service strip', () => {
  it('draws one station per step, each with the glyph and the name of its state', () => {
    render(
      <ServiceStrip
        stations={[
          at('Inicio', 'succeeded', 'Completado'),
          at('Decidir', 'running', 'En curso'),
          at('Cobrar', 'pending', 'Pendiente'),
        ]}
      />,
    );
    const strip = screen.getByRole('list', { name: 'Tira de servicio' });
    expect(within(strip).getAllByRole('listitem')).toHaveLength(3);
    expect(marks().map((mark) => mark.getAttribute('data-state'))).toEqual([
      'succeeded',
      'running',
      'pending',
    ]);
    for (const mark of marks()) expect(mark.querySelector('svg')).not.toBeNull();
    expect(within(strip).getByText('Decidir: En curso')).toBeDefined();
  });

  it('folds the tail into «+N» when there are many steps', () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      at(`Paso ${index + 1}`, 'succeeded', 'Completado'),
    );
    render(<ServiceStrip stations={many} max={8} />);
    expect(marks()).toHaveLength(7);
    expect(screen.getByText('+5')).toBeDefined();
    expect(screen.getByText('y 5 pasos más')).toBeDefined();
  });

  it('holds its space while the detail of the run arrives', () => {
    const { rerender } = render(<ServiceStrip stations={undefined} />);
    const placeholder = document.querySelector('[data-strip-placeholder]') as HTMLElement;
    expect(placeholder).not.toBeNull();
    expect(placeholder.getAttribute('aria-busy')).toBe('true');
    expect(placeholder.className).toMatch(/\bh-6\b/);
    expect(marks()).toHaveLength(0);

    rerender(<ServiceStrip stations={[at('Inicio', 'succeeded', 'Completado')]} />);
    const strip = screen.getByRole('list', { name: 'Tira de servicio' });
    // The same height as the placeholder: nothing below it jumps.
    expect(strip.className).toMatch(/\bh-6\b/);
  });

  it('redraws only the station that changes', () => {
    const first = at('Inicio', 'succeeded', 'Completado');
    const { rerender } = render(
      <ServiceStrip stations={[first, at('Decidir', 'running', 'En curso')]} />,
    );
    const [before] = marks();
    rerender(<ServiceStrip stations={[first, at('Decidir', 'succeeded', 'Completado')]} />);
    const [after, changed] = marks();
    expect(after).toBe(before);
    expect(changed!.getAttribute('data-state')).toBe('succeeded');
    // A station is memoised on its own values, so a new object with the same values is not redrawn.
    expect((StripStationMark as unknown as { $$typeof: symbol }).$$typeof).toBe(
      Symbol.for('react.memo'),
    );
  });

  it('follows the order of the definition, with the steps that did not start as pending', () => {
    const detail = {
      ...run({ status: 'running' }),
      definition: DEFINITION,
      steps: [
        step('alto', { status: 'running', waitingReason: 'approval' }),
        step('inicio', { status: 'succeeded' }),
      ],
    } as unknown as RunDetail;
    expect(stripStations(detail)).toEqual([
      expect.objectContaining({ nodeId: 'inicio', label: 'Inicio', state: 'succeeded' }),
      expect.objectContaining({ nodeId: 'alto', label: '¿Monto alto?', state: 'waiting' }),
      expect.objectContaining({ nodeId: 'servicio_a', label: 'Servicio A', state: 'pending' }),
    ]);
  });
});

describe('loading the strip of a row', () => {
  it('never runs more than the limit at once', async () => {
    const limit = createLimiter(8);
    let running = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const task = () =>
      limit(
        () =>
          new Promise<void>((resolve) => {
            running += 1;
            peak = Math.max(peak, running);
            releases.push(() => {
              running -= 1;
              resolve();
            });
          }),
      );
    const all = Promise.all(Array.from({ length: 20 }, task));
    await vi.waitFor(() => expect(releases.length).toBe(8));
    while (releases.length > 0) {
      releases.shift()!();
      await Promise.resolve();
      await Promise.resolve();
    }
    await all;
    expect(peak).toBe(8);
  });

  it('asks for the detail only once the row is on screen', async () => {
    let reveal: ((entries: Array<{ isIntersecting: boolean }>) => void) | undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
          reveal = callback;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith(`/runs/${RUN_ID}`)
          ? json({
              ...run({ status: 'succeeded', finishedAt: '2026-10-30T12:00:05.000Z' }),
              definition: DEFINITION,
              steps: [
                step('inicio', { status: 'succeeded' }),
                step('alto', { status: 'succeeded' }),
                step('servicio_a', { status: 'succeeded' }),
              ],
            })
          : json({}, 404),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <LazyServiceStrip organizationId={ORG_ID} runId={RUN_ID} final />
      </QueryClientProvider>,
    );

    expect(document.querySelector('[data-strip-placeholder]')).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => {
      reveal?.([{ isIntersecting: true }]);
    });
    await waitFor(() => expect(marks()).toHaveLength(3));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // A finished run never changes: its strip is never asked for again.
    expect(client.getQueryCache().findAll()[0]?.options).toMatchObject({ staleTime: Infinity });
  });
});
