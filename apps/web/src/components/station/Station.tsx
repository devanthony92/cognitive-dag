import { TriangleAlert } from 'lucide-react';
import { NODE_CATALOG, type NodeType } from '@cognitive-dag/dag-schema';
import { CATEGORIES, CATEGORY_IDS, categoryOfType, type CategoryId } from '../category/categories';
import { StatusMark } from '../status/StatusBadge';
import type { ServiceState } from '../status/statusGlyphs';
import { categorySymbolId } from './CategorySprite';
import './station.css';

export interface StationProps {
  type: NodeType;
  label: string;
  selected?: boolean;
  /** State of the step in a run; the editor has none, so it shows no badge. */
  state?: ServiceState;
  /** Spanish name of that state («Completado»), read with the badge. */
  stateLabel?: string;
  /** Problems of the node in the draft. */
  problems?: number;
  /** The messages of those problems, for the pointer. */
  problemTitle?: string;
  /** A short note under the type, such as «Esperando por el límite». */
  note?: string;
}

/* Class strings are built once: a plan can hold 50 stations and none of them should run a class merger. */
const CIRCLE_BASE =
  'absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-station border-4 bg-surface transition-[width,height] duration-(--duration-state) ease-line';
const CIRCLE_CLASS = Object.fromEntries(
  CATEGORY_IDS.flatMap((id) => [
    [`${id}:0`, `${CIRCLE_BASE} size-10 ${CATEGORIES[id].borderClass} ${CATEGORIES[id].textClass}`],
    [
      `${id}:1`,
      `${CIRCLE_BASE} size-12 shadow-(--ring-focus) ${CATEGORIES[id].borderClass} ${CATEGORIES[id].textClass}`,
    ],
  ]),
) as Record<`${CategoryId}:${0 | 1}`, string>;
const CIRCLE_UNKNOWN = `${CIRCLE_BASE} size-10 border-line-strong text-ink-muted`;
const BADGE_CLASS = [
  'absolute -top-1.5 -right-1.5 size-[18px]',
  'absolute -top-2.5 -right-2.5 size-[18px]',
];
const PROBLEM_BASE =
  'absolute flex h-[18px] items-center gap-0.5 rounded-station border-2 border-ground bg-state-failed px-1 text-label font-semibold text-ground';
const PROBLEM_CLASS = [`${PROBLEM_BASE} -top-2 -right-4`, `${PROBLEM_BASE} -top-3 -right-5`];

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * What assistive technology reads for a station: name, category, type, state and problems. React Flow
 * puts it on the focusable box of the node.
 */
export function stationDescription({
  type,
  label,
  problems = 0,
  stateLabel,
}: Pick<StationProps, 'type' | 'label' | 'problems' | 'stateLabel'>): string {
  const category = categoryOfType(type);
  const parts = [label];
  if (category) parts.push(CATEGORIES[category].label);
  parts.push(NODE_CATALOG[type].label);
  if (stateLabel) parts.push(stateLabel);
  if (problems > 0) parts.push(plural(problems, 'problema', 'problemas'));
  return parts.join(', ');
}

/**
 * A node drawn as a metro station (DESIGN.md, Nodo del editor): a 40 px circle with a 4 px border in
 * the colour of its category and its pictogram inside; 48 px with the double ring when selected. Name
 * and type sit underneath at a fixed size (they do not scale with the zoom of the canvas). In a run a
 * badge of 18 px carries the state; in the editor a mark carries the problems. The box of the station
 * is the 40 px circle, so the ports of React Flow sit on its edge.
 */
export function Station({
  type,
  label,
  selected = false,
  state,
  stateLabel,
  problems = 0,
  problemTitle,
  note,
}: StationProps) {
  const category = categoryOfType(type);
  return (
    <div data-station className="relative size-10">
      <div
        data-station-circle
        data-category={category}
        className={category ? CIRCLE_CLASS[`${category}:${selected ? 1 : 0}`] : CIRCLE_UNKNOWN}
      >
        {category && (
          <svg
            className="size-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
            focusable="false"
          >
            <use href={`#${categorySymbolId(category)}`} />
          </svg>
        )}
      </div>

      {state && (
        <span data-station-badge data-state={state} className={BADGE_CLASS[selected ? 1 : 0]}>
          <StatusMark state={state} label={stateLabel ?? ''} />
        </span>
      )}

      {problems > 0 && (
        <span
          data-testid="node-errors"
          title={problemTitle}
          className={PROBLEM_CLASS[selected ? 1 : 0]}
        >
          <TriangleAlert className="size-3" strokeWidth={2.5} aria-hidden />
          <span className="sr-only">Problemas:</span>
          <span className="tabular">{problems}</span>
        </span>
      )}

      <div
        data-station-labels
        className="station-labels pointer-events-none absolute top-full left-1/2 mt-2 w-32 -translate-x-1/2 text-center"
      >
        <p className="truncate text-[13px] leading-tight font-semibold text-ink">{label}</p>
        <p className="truncate text-body-sm leading-tight text-ink-muted">
          {NODE_CATALOG[type].label}
        </p>
        {note && <p className="truncate text-body-sm leading-tight text-state-waiting">{note}</p>}
      </div>
    </div>
  );
}
