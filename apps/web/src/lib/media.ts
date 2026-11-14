import { useSyncExternalStore } from 'react';

/** Below the md breakpoint of Tailwind (768 px): a phone, where the editor works with bottom sheets. */
export const PHONE_QUERY = '(max-width: 767px)';
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function list(query: string): MediaQueryList | undefined {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query)
    : undefined;
}

/**
 * Whether a media query matches now, following its changes. Without `matchMedia` (an old browser,
 * the test DOM) it answers false: the wide layout and full motion are the defaults.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const media = list(query);
      media?.addEventListener('change', notify);
      return () => media?.removeEventListener('change', notify);
    },
    () => list(query)?.matches ?? false,
    () => false,
  );
}
