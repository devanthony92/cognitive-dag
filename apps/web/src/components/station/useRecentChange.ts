import { useEffect, useRef, useState } from 'react';
import { REDUCED_MOTION_QUERY, useMediaQuery } from '../../lib/media';

/** How long a row that changed state stays highlighted (DESIGN.md, Tabla de ejecuciones). */
export const RECENT_CHANGE_MS = 8000;

/**
 * Marks a row whose `value` (its status) changed after the first render. The mark ends when the row
 * receives the focus or after 8 s, and a new change starts the 8 s again. The highlight is a
 * background, not an animation; it only fades in when the user has not asked for reduced motion.
 */
export function useRecentChange(value: string) {
  const [changed, setChanged] = useState(false);
  const previous = useRef(value);
  const reduced = useMediaQuery(REDUCED_MOTION_QUERY);

  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    setChanged(true);
    const timer = setTimeout(() => setChanged(false), RECENT_CHANGE_MS);
    return () => clearTimeout(timer);
  }, [value]);

  return {
    changed,
    onFocus: () => setChanged(false),
    className: [changed && 'bg-raised', !reduced && 'transition-colors duration-(--duration-state)']
      .filter(Boolean)
      .join(' '),
  };
}
