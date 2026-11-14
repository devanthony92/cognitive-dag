/// <reference types="node" />
/**
 * The station (F10, FR-027, T054): the node of the editor and of the run view drawn as a metro
 * station. A 40 px circle (48 px selected) with the pictogram of its category, the name and type
 * underneath at a fixed size, a 4 px border in the colour of the category, the 18 px state badge only
 * in a run, and an accessible description that says category, name and problems.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { NODE_CATALOG, NODE_TYPES } from '@cognitive-dag/dag-schema';
import { categoryOfType, CATEGORIES } from '../src/components/category/categories';
import { Station, stationDescription } from '../src/components/station/Station';
const stationCss = readFileSync('src/components/station/station.css', 'utf8');

afterEach(cleanup);

const circle = () => document.querySelector('[data-station-circle]') as HTMLElement;

describe('station', () => {
  it('is a 40 px circle with a 4 px border in the colour of its category and its pictogram', () => {
    render(<Station type="llm.classify" label="Clasificar ticket" />);
    const shape = circle();
    expect(shape.className).toMatch(/\bsize-10\b/);
    expect(shape.className).toMatch(/\brounded-station\b/);
    expect(shape.className).toMatch(/\bborder-4\b/);
    expect(shape.className).toMatch(/\bborder-node-llm\b/);
    expect(shape.className).toMatch(/\bbg-surface\b/);
    const pictogram = shape.querySelector('svg');
    expect(pictogram).not.toBeNull();
    expect(pictogram?.getAttribute('class')).toMatch(/\bsize-6\b/);
    expect(pictogram?.getAttribute('stroke-width')).toBe('2');
  });

  it('grows to 48 px with the double focus ring when selected', () => {
    render(<Station type="logic.condition" label="¿Monto alto?" selected />);
    expect(circle().className).toMatch(/\bsize-12\b/);
    expect(circle().className).not.toMatch(/\bsize-10\b/);
    expect(circle().className).toMatch(/shadow-\(--ring-focus\)/);
  });

  it('draws the focus ring of the keyboard on the station, not on the box around it', () => {
    // React Flow focuses the wrapper of the node; the ring belongs on the circle inside it.
    expect(stationCss).toMatch(
      /\.react-flow__node:focus-visible[^{]*\[data-station-circle\][^{]*\{[^}]*--ring-focus/,
    );
  });

  it('puts the name and the type under the station at a fixed size of at least 12 px', () => {
    render(<Station type="http.request" label="Consultar pedido" />);
    const name = screen.getByText('Consultar pedido');
    const type = screen.getByText(NODE_CATALOG['http.request'].label);
    // 13 px name, body-sm (13 px) type: never the 10 or 11 px of before.
    expect(name.className).toMatch(/text-\[13px\]/);
    expect(type.className).toMatch(/\btext-body-sm\b/);
    // The labels sit outside the circle and do not scale with the zoom of the canvas.
    const labels = name.closest('[data-station-labels]') as HTMLElement;
    expect(labels).not.toBeNull();
    expect(circle().contains(labels)).toBe(false);
    expect(labels.className).toMatch(/\bstation-labels\b/);
    expect(stationCss).toMatch(/\.station-labels\s*\{[^}]*scale:[^}]*--canvas-zoom/);
  });

  it('has no state badge in the editor and an 18 px one in a run', () => {
    const { unmount } = render(<Station type="mock.service" label="Servicio" />);
    expect(document.querySelector('[data-station-badge]')).toBeNull();
    unmount();

    render(<Station type="mock.service" label="Servicio" state="failed" stateLabel="Fallido" />);
    const badge = document.querySelector('[data-station-badge]') as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.className).toMatch(/size-\[18px\]/);
    expect(badge.getAttribute('data-state')).toBe('failed');
    expect(badge.textContent).toContain('Fallido');
  });

  it('marks problems with a glyph and a count, never with colour alone', () => {
    render(
      <Station type="llm.generate" label="Resumir" problems={2} problemTitle="Falta conexión" />,
    );
    const problems = screen.getByTestId('node-errors');
    expect(problems.querySelector('svg')).not.toBeNull();
    expect(problems.textContent).toMatch(/2/);
  });

  it('gives every type of the catalog its category pictogram', () => {
    for (const type of NODE_TYPES) {
      const { unmount } = render(<Station type={type} label={type} />);
      const category = categoryOfType(type);
      expect(category, type).toBeDefined();
      expect(circle().getAttribute('data-category')).toBe(category);
      expect(circle().className).toContain(CATEGORIES[category!].borderClass);
      unmount();
    }
  });

  it('describes itself for assistive technology: category, name, type and problems', () => {
    expect(stationDescription({ type: 'llm.classify', label: 'Clasificar' })).toBe(
      'Clasificar, LLM, Clasificar',
    );
    expect(stationDescription({ type: 'human.approval', label: 'Visto bueno', problems: 1 })).toBe(
      'Visto bueno, Aprobación humana, Aprobación humana, 1 problema',
    );
    expect(
      stationDescription({
        type: 'trigger.manual',
        label: 'Inicio',
        problems: 3,
        stateLabel: 'Completado',
      }),
    ).toBe('Inicio, Disparador, Disparador manual, Completado, 3 problemas');
  });
});
