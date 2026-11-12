import type { SVGProps } from 'react';
import { cn } from '../../lib/utils';

/**
 * The eight service states of the design (DESIGN.md, Estado de servicio): the seven of the design plus
 * Pendiente, the step that has not started. Every state has its own glyph, so state never relies on
 * colour alone: the glyphs stay distinguishable in greyscale.
 */
export const SERVICE_STATES = [
  'running',
  'succeeded',
  'failed',
  'waiting',
  'cancelled',
  'skipped',
  'reused',
  'pending',
] as const;

export type ServiceState = (typeof SERVICE_STATES)[number];

/** Token of each state as a text colour; Pendiente has no state colour and uses the muted ink. */
export const STATE_TEXT_CLASS: Record<ServiceState, string> = {
  running: 'text-state-running',
  succeeded: 'text-state-succeeded',
  failed: 'text-state-failed',
  waiting: 'text-state-waiting',
  cancelled: 'text-state-cancelled',
  skipped: 'text-state-skipped',
  reused: 'text-state-reused',
  pending: 'text-ink-muted',
};

/** The same token as a fill, for the 18 px badge of a station. */
export const STATE_FILL_CLASS: Record<ServiceState, string> = {
  running: 'bg-state-running',
  succeeded: 'bg-state-succeeded',
  failed: 'bg-state-failed',
  waiting: 'bg-state-waiting',
  cancelled: 'bg-state-cancelled',
  skipped: 'bg-state-skipped',
  reused: 'bg-state-reused',
  pending: 'bg-ink-muted',
};

/**
 * 45° hatch inside a circle of radius 9 centred at (12, 12): the chords y = x + k, drawn as plain
 * lines so no `<pattern>` id can clash when many glyphs share a page.
 */
const HATCH = [
  'M5.64 5.64L18.36 18.36',
  'M3.65 8.65L15.35 20.35',
  'M8.65 3.65L20.35 15.35',
  'M3 12L12 21',
  'M12 3L21 12',
] as const;

const RING = <circle cx="12" cy="12" r="10" />;

const REUSE_ARROW = (
  <>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </>
);

function Shapes({ state, ring }: { state: ServiceState; ring: boolean }) {
  switch (state) {
    case 'running':
      return <path d="M21 12a9 9 0 1 1-6.22-8.56" />;
    case 'succeeded':
      return (
        <>
          {ring && RING}
          <path d={ring ? 'M8 12.5l2.7 2.7L16 9.5' : 'M6 12.5l4 4 8-9'} />
        </>
      );
    case 'failed':
      return (
        <>
          {ring && RING}
          <path d={ring ? 'M9 9l6 6M15 9l-6 6' : 'M7 7l10 10M17 7L7 17'} />
        </>
      );
    case 'waiting':
      return (
        <path d="M7 3h10M7 21h10M8 3v3.5a4 4 0 0 0 1.2 2.8L12 12l2.8-2.7A4 4 0 0 0 16 6.5V3M8 21v-3.5a4 4 0 0 1 1.2-2.8L12 12l2.8 2.7a4 4 0 0 1 1.2 2.8V21" />
      );
    case 'cancelled':
      return (
        <>
          {ring && RING}
          <path d={ring ? 'M5.6 18.4L18.4 5.6' : 'M6 18L18 6'} />
        </>
      );
    case 'skipped':
      return (
        <>
          {ring && <circle cx="12" cy="12" r="9" />}
          {HATCH.map((line) => (
            <path key={line} d={line} />
          ))}
        </>
      );
    case 'reused':
      return ring ? (
        <>
          <circle cx="12" cy="12" r="10" strokeDasharray="3.2 3" />
          <g transform="translate(6 6) scale(.5)" strokeWidth="4">
            {REUSE_ARROW}
          </g>
        </>
      ) : (
        <g transform="translate(3 3) scale(.75)" strokeWidth="2.7">
          {REUSE_ARROW}
        </g>
      );
    case 'pending':
      return ring ? (
        <circle cx="12" cy="12" r="10" strokeWidth="1.5" />
      ) : (
        <circle cx="12" cy="12" r="6" />
      );
  }
}

/**
 * The glyph of a state. `ring` is the badge glyph (a circle with the mark inside, or the open arc of
 * «En curso»); `bare` is the mark alone, for the 18 px badge of a station, where it is drawn in the
 * ground colour over the state colour. «En curso» turns slowly unless the user asks for less motion.
 */
export function StatusGlyph({
  state,
  variant = 'ring',
  className,
  ...props
}: { state: ServiceState; variant?: 'ring' | 'bare' } & Omit<SVGProps<SVGSVGElement>, 'children'>) {
  const ring = variant === 'ring';
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={ring ? 2 : 3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-state={state}
      className={cn(
        'size-[18px] shrink-0',
        state === 'running' && 'motion-safe:animate-spin-slow',
        className,
      )}
      {...props}
    >
      <Shapes state={state} ring={ring} />
    </svg>
  );
}
