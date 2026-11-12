import { cn } from '../../lib/utils';

/**
 * Brand mark: a station ring with the registration cross of a printed map, drawn in `currentColor`
 * (the cross takes the running colour). Legible at 16 px in both modes; `public/favicon.svg` is the
 * same mark on an enamel tile.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('size-6 shrink-0', className)}>
      <circle cx="16" cy="16" r="7" fill="none" stroke="currentColor" strokeWidth="3.5" />
      <path
        d="M16 3v6M16 23v6M3 16h6M23 16h6"
        className="stroke-state-running"
        strokeWidth="3"
        strokeLinecap="butt"
        fill="none"
      />
    </svg>
  );
}
