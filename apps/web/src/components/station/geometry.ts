/**
 * Geometry of the line between two stations (DESIGN.md, Shapes; research R9): segments at 0°, 45° and
 * 90° only, bends rounded with a fixed 12 px corner. The flow runs from left to right, so a line leaves
 * its source to the right and enters its target from the left.
 */

export interface Point {
  x: number;
  y: number;
}

/** Radius of every bend of a line. */
export const EDGE_CORNER_RADIUS = 12;
/** Width of a line. */
export const EDGE_WIDTH = 5;

/** Shortest straight run at each end, so a line never bends right on top of a port. */
const STUB = 24;
/** Below this height difference two stations are at the same level. */
const SAME_LEVEL = 0.5;
/** A line that goes back at about the same level runs this far below the stations and their labels. */
const LOOP_BELOW = 96;

/**
 * Corners of the route from a source port to a target port.
 *
 * - Same level: a straight line.
 * - Forward with room: horizontal, a 45° diagonal that covers the whole height, horizontal.
 * - Forward without room for the diagonal: falls back to 90° (horizontal, vertical, horizontal).
 * - Backward: out to the right, down (or up) to a lane between them (below both when they are at the
 *   same level), back to the left past the target, and into it from the left, all at 90°.
 */
export function routeStationEdge(source: Point, target: Point): Point[] {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const height = Math.abs(dy);

  if (dx > 0 && height < SAME_LEVEL) return [source, target];

  if (dx > 0) {
    if (dx >= height + 2 * STUB) {
      const run = (dx - height) / 2;
      return [
        source,
        { x: source.x + run, y: source.y },
        { x: target.x - run, y: target.y },
        target,
      ];
    }
    const middle = source.x + dx / 2;
    return [source, { x: middle, y: source.y }, { x: middle, y: target.y }, target];
  }

  const out = source.x + STUB;
  const into = target.x - STUB;
  const lane =
    height < LOOP_BELOW ? Math.max(source.y, target.y) + LOOP_BELOW : (source.y + target.y) / 2;
  return [
    source,
    { x: out, y: source.y },
    { x: out, y: lane },
    { x: into, y: lane },
    { x: into, y: target.y },
    target,
  ];
}

const round = (value: number): string => {
  const fixed = Math.round(value * 100) / 100;
  return String(Object.is(fixed, -0) ? 0 : fixed);
};
const at = (point: Point) => `${round(point.x)} ${round(point.y)}`;
const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const toward = (from: Point, to: Point, length: number): Point => {
  const total = distance(from, to);
  return total === 0
    ? from
    : {
        x: from.x + ((to.x - from.x) / total) * length,
        y: from.y + ((to.y - from.y) / total) * length,
      };
};

/**
 * SVG path through the corners, every bend rounded with a quadratic curve whose control point is the
 * corner. The radius never goes past the middle of a segment, so two close bends do not overlap.
 */
export function roundedPath(points: readonly Point[], radius = EDGE_CORNER_RADIUS): string {
  const first = points[0];
  if (!first) return '';
  const parts = [`M${at(first)}`];
  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1]!;
    const corner = points[i]!;
    const next = points[i + 1]!;
    const r = Math.min(radius, distance(previous, corner) / 2, distance(corner, next) / 2);
    parts.push(
      `L${at(toward(corner, previous, r))}`,
      `Q${at(corner)} ${at(toward(corner, next, r))}`,
    );
  }
  const last = points.at(-1);
  if (last && points.length > 1) parts.push(`L${at(last)}`);
  return parts.join(' ');
}

/** Where the branch label of a line sits: on its first run, close to the source port. */
export function labelPoint(points: readonly Point[]): Point {
  const [start, next] = points;
  if (!start) return { x: 0, y: 0 };
  if (!next) return start;
  return toward(start, next, Math.min(32, distance(start, next) / 2));
}

/** Middle of the route, measured along it: where the problem mark of a line sits. */
export function middlePoint(points: readonly Point[]): Point {
  const lengths = points.slice(1).map((point, index) => distance(points[index]!, point));
  let remaining = lengths.reduce((sum, value) => sum + value, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]!;
    if (remaining <= length) return toward(points[i]!, points[i + 1]!, remaining);
    remaining -= length;
  }
  return points.at(-1) ?? { x: 0, y: 0 };
}
