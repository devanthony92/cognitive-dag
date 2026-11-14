/**
 * The line between two stations (F10, FR-027, T055; research R9): segments at 0°, 45° and 90° only,
 * 12 px rounded corners, 5 px wide, in the colour of the category of the source, and «sí» / «no» on
 * the two branches of a condition. Falls back to 90° when there is no room for the diagonal.
 */
import { cleanup, render } from '@testing-library/react';
import { Position, type EdgeProps } from '@xyflow/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { DagDefinition } from '@cognitive-dag/dag-schema';
import {
  EDGE_CORNER_RADIUS,
  EDGE_WIDTH,
  roundedPath,
  routeStationEdge,
  type Point,
} from '../src/components/station/geometry';
import { StationEdge, type StationEdgeType } from '../src/components/station/StationEdge';
import { buildEdges } from '../src/features/workflows/flow';
import { groupErrors } from '../src/features/workflows/model';

afterEach(cleanup);

/** Angle of every segment, folded to 0..90 (direction does not matter for the rule). */
function angles(points: readonly Point[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const deg = Math.abs((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
    out.push(Math.round(deg > 90 ? 180 - deg : deg));
  }
  return out;
}

const length = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

function expectOnlyMetroAngles(points: readonly Point[]) {
  for (const angle of angles(points)) expect([0, 45, 90]).toContain(angle);
  // No zero-length segment: every vertex is a real bend.
  for (let i = 1; i < points.length; i++)
    expect(length(points[i - 1]!, points[i]!)).toBeGreaterThan(0);
}

function expectEnds(points: readonly Point[], source: Point, target: Point) {
  expect(points[0]).toEqual(source);
  expect(points.at(-1)).toEqual(target);
  // It leaves the source to the right and enters the target from the left.
  expect(points[1]!.x).toBeGreaterThan(source.x);
  expect(points[1]!.y).toBe(source.y);
  expect(points.at(-2)!.x).toBeLessThan(target.x);
  expect(points.at(-2)!.y).toBe(target.y);
}

describe('route of a station edge', () => {
  it('is a straight line between stations at the same level', () => {
    const route = routeStationEdge({ x: 0, y: 100 }, { x: 300, y: 100 });
    expect(route).toEqual([
      { x: 0, y: 100 },
      { x: 300, y: 100 },
    ]);
  });

  it('goes down with a 45° diagonal between two horizontal runs', () => {
    const source = { x: 0, y: 0 };
    const target = { x: 300, y: 120 };
    const route = routeStationEdge(source, target);
    expectOnlyMetroAngles(route);
    expectEnds(route, source, target);
    expect(angles(route)).toContain(45);
    expect(angles(route)).not.toContain(90);
  });

  it('goes up with a 45° diagonal too', () => {
    const source = { x: 0, y: 200 };
    const target = { x: 400, y: 40 };
    const route = routeStationEdge(source, target);
    expectOnlyMetroAngles(route);
    expectEnds(route, source, target);
    expect(angles(route)).toContain(45);
  });

  it('falls back to 90° when there is no room for the diagonal', () => {
    const source = { x: 0, y: 0 };
    const target = { x: 80, y: 300 };
    const route = routeStationEdge(source, target);
    expectOnlyMetroAngles(route);
    expectEnds(route, source, target);
    expect(angles(route)).toContain(90);
    expect(angles(route)).not.toContain(45);
  });

  it('goes around when the target is behind the source', () => {
    const source = { x: 400, y: 0 };
    const target = { x: 0, y: 200 };
    const route = routeStationEdge(source, target);
    expectOnlyMetroAngles(route);
    expectEnds(route, source, target);
    expect(new Set(angles(route))).toEqual(new Set([0, 90]));
  });

  it('goes around below the stations when the target is behind at the same level', () => {
    const source = { x: 400, y: 50 };
    const target = { x: 0, y: 50 };
    const route = routeStationEdge(source, target);
    expectOnlyMetroAngles(route);
    expectEnds(route, source, target);
    // It must not run back over the stations and their labels.
    expect(Math.max(...route.map((point) => point.y))).toBeGreaterThan(50 + 40);
  });
});

/** Every `Q cx cy x y` of the path, with the point where the curve starts. */
function corners(path: string) {
  const tokens = path.match(/[MLQ]|-?\d+(?:\.\d+)?/g) ?? [];
  const out: Array<{ from: Point; control: Point; to: Point }> = [];
  let cursor: Point = { x: 0, y: 0 };
  for (let i = 0; i < tokens.length;) {
    const command = tokens[i++];
    if (command === 'M' || command === 'L') {
      cursor = { x: Number(tokens[i++]), y: Number(tokens[i++]) };
    } else if (command === 'Q') {
      const control = { x: Number(tokens[i++]), y: Number(tokens[i++]) };
      const to = { x: Number(tokens[i++]), y: Number(tokens[i++]) };
      out.push({ from: cursor, control, to });
      cursor = to;
    }
  }
  return out;
}

describe('path of a station edge', () => {
  it('rounds every bend with a 12 px corner', () => {
    expect(EDGE_CORNER_RADIUS).toBe(12);
    expect(EDGE_WIDTH).toBe(5);
    const route = routeStationEdge({ x: 0, y: 0 }, { x: 400, y: 160 });
    const path = roundedPath(route);
    const bends = corners(path);
    expect(bends).toHaveLength(route.length - 2);
    bends.forEach((bend, index) => {
      expect(bend.control).toEqual(route[index + 1]);
      expect(length(bend.from, bend.control)).toBeCloseTo(12, 0);
      expect(length(bend.control, bend.to)).toBeCloseTo(12, 0);
    });
  });

  it('never rounds beyond the middle of a short segment', () => {
    const route: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 40, y: 10 },
    ];
    for (const bend of corners(roundedPath(route))) {
      expect(length(bend.from, bend.control)).toBeLessThanOrEqual(5);
    }
  });
});

const CONDITION: DagDefinition = {
  schemaVersion: 1,
  nodes: [
    {
      id: 'inicio',
      type: 'trigger.manual',
      label: 'Inicio',
      position: { x: 0, y: 0 },
      config: { inputSchema: [] },
    },
    {
      id: 'alto',
      type: 'logic.condition',
      label: '¿Alto?',
      position: { x: 200, y: 0 },
      config: {},
    },
    { id: 'a', type: 'mock.service', label: 'A', position: { x: 400, y: 0 }, config: {} },
    { id: 'b', type: 'mock.service', label: 'B', position: { x: 400, y: 200 }, config: {} },
  ],
  edges: [
    { id: 'e1', source: 'inicio', sourceHandle: 'out', target: 'alto' },
    { id: 'e2', source: 'alto', sourceHandle: 'true', target: 'a' },
    { id: 'e3', source: 'alto', sourceHandle: 'false', target: 'b' },
  ],
} as unknown as DagDefinition;

describe('edges of the canvas', () => {
  it('are station edges in the colour of the category of their source', () => {
    const edges = buildEdges(CONDITION, groupErrors([]), new Set(), false);
    expect(edges.map((edge) => edge.type)).toEqual(['station', 'station', 'station']);
    expect(edges.map((edge) => (edge.data as { category: string }).category)).toEqual([
      'trigger',
      'logic',
      'logic',
    ]);
  });

  it('label the two branches of a condition «sí» and «no»', () => {
    const edges = buildEdges(CONDITION, groupErrors([]), new Set(), false);
    expect(edges[0]!.label).toBeUndefined();
    expect(edges[1]!.label as string).toMatch(/^sí$/i);
    expect(edges[2]!.label as string).toMatch(/^no$/i);
  });

  const props = (data: StationEdgeType['data'], label?: string) =>
    ({
      id: 'e2',
      source: 'alto',
      target: 'a',
      sourceX: 0,
      sourceY: 0,
      targetX: 300,
      targetY: 120,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data,
      label,
      selected: false,
      animated: false,
      deletable: true,
      selectable: true,
      interactionWidth: 20,
    }) as unknown as EdgeProps<StationEdgeType>;

  it('draws a 5 px line in the category colour, with its branch label', () => {
    const { container } = render(
      <svg>
        <StationEdge {...props({ category: 'logic' }, 'Sí')} />
      </svg>,
    );
    const group = container.querySelector('[data-station-edge]') as SVGGElement;
    expect(group.getAttribute('data-category')).toBe('logic');
    const line = container.querySelector('path.react-flow__edge-path') as SVGPathElement;
    expect(line.getAttribute('d')).toMatch(/^M0 0/);
    expect(line.getAttribute('stroke-width')).toBe('5');
    expect(container.textContent).toContain('Sí');
  });

  it('draws a problem in the failed colour with a glyph, not with colour alone', () => {
    const { container } = render(
      <svg>
        <StationEdge {...props({ category: 'logic', problem: 'Conexión que forma un ciclo' })} />
      </svg>,
    );
    const group = container.querySelector('[data-station-edge]') as SVGGElement;
    expect(group.getAttribute('data-problem')).toBe('true');
    const mark = container.querySelector('[data-edge-problem]') as SVGGElement;
    expect(mark.querySelector('path, line')).not.toBeNull();
    expect(mark.querySelector('title')?.textContent).toBe('Conexión que forma un ciclo');
  });
});
