import type { Edge, EdgeProps } from '@xyflow/react';
import { memo, useMemo } from 'react';
import type { CategoryId } from '../category/categories';
import { EDGE_WIDTH, labelPoint, middlePoint, roundedPath, routeStationEdge } from './geometry';
import './station.css';

export interface StationEdgeData extends Record<string, unknown> {
  /** Category of the source station: the colour of the line. */
  category?: CategoryId | undefined;
  /** What is wrong with the line in the draft; drawn in the failed colour with a ✕ mark. */
  problem?: string | undefined;
  /** The line runs into a skipped step of a run. */
  dimmed?: boolean | undefined;
}

export type StationEdgeType = Edge<StationEdgeData, 'station'>;

/** Rough width of a 12 px semibold label: enough for «Sí», «No» and «Rechazado». */
const tagWidth = (text: string) => Math.round(16 + text.length * 7.2);

/**
 * A line of the plan (research R9): 0°, 45° and 90° only, with 12 px corners, 5 px wide, in the
 * colour of the category of its source. The branch of a condition or an approval carries its name
 * («Sí», «No»…) next to the source; a problem carries a ✕ mark and a dash. Pure SVG, positioned with
 * SVG attributes, so the CSP needs no inline style.
 */
function StationEdgeBase({
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  label,
  interactionWidth = 24,
  markerEnd,
}: EdgeProps<StationEdgeType>) {
  const points = useMemo(
    () => routeStationEdge({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }),
    [sourceX, sourceY, targetX, targetY],
  );
  const path = useMemo(() => roundedPath(points), [points]);
  const text = typeof label === 'string' && label !== '' ? label : undefined;
  const tag = text ? labelPoint(points) : undefined;
  const mark = data?.problem ? middlePoint(points) : undefined;

  return (
    <g
      data-station-edge
      data-category={data?.category}
      data-problem={data?.problem ? 'true' : undefined}
      data-dimmed={data?.dimmed ? 'true' : undefined}
      className="station-edge"
    >
      <path d={path} className="station-edge-halo" />
      <path
        d={path}
        fill="none"
        strokeWidth={EDGE_WIDTH}
        className="react-flow__edge-path station-edge-path"
        markerEnd={markerEnd}
      />
      <path
        d={path}
        fill="none"
        strokeOpacity={0}
        strokeWidth={interactionWidth}
        className="react-flow__edge-interaction"
      />
      {text && tag && (
        <g transform={`translate(${tag.x} ${tag.y})`} aria-hidden="true">
          <g className="station-edge-tag">
            <rect x={-tagWidth(text) / 2} y={-11} width={tagWidth(text)} height={22} rx={11} />
            <text textAnchor="middle" dominantBaseline="central">
              {text}
            </text>
          </g>
        </g>
      )}
      {mark && (
        <g transform={`translate(${mark.x} ${mark.y})`} data-edge-problem>
          <g className="station-edge-tag station-edge-problem">
            <title>{data?.problem}</title>
            <circle r={10} />
            <path d="M-3.5 -3.5L3.5 3.5M3.5 -3.5L-3.5 3.5" />
          </g>
        </g>
      )}
    </g>
  );
}

export const StationEdge = memo(StationEdgeBase);
