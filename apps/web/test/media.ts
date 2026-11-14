import { vi } from 'vitest';

/**
 * jsdom has no media queries. This makes `window.matchMedia` answer the queries given as matching and
 * every other one as not matching, so a test can play a phone (`(max-width: 767px)`) or ask for
 * reduced motion (`(prefers-reduced-motion: reduce)`). `vi.unstubAllGlobals()` undoes it.
 */
export function stubMedia(...matching: string[]): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string): MediaQueryList =>
      ({
        matches: matching.includes(query),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

export const PHONE = '(max-width: 767px)';
export const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
