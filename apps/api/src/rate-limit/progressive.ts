/** Failures in a row from which every further attempt must wait (FR-012). */
export const PROGRESSIVE_THRESHOLD = 5;
export const PROGRESSIVE_MAX_DELAY_SECONDS = 15 * 60;
/** The failure counter forgets itself this long after the last failure. */
export const PROGRESSIVE_WINDOW_SECONDS = 15 * 60;

/**
 * Wait imposed after the `failures`-th failure: none up to the 4th, then 1 s from the 5th,
 * doubling with each failure, capped at 15 minutes.
 */
export function progressiveDelaySeconds(failures: number): number {
  if (failures < PROGRESSIVE_THRESHOLD) return 0;
  return Math.min(2 ** (failures - PROGRESSIVE_THRESHOLD), PROGRESSIVE_MAX_DELAY_SECONDS);
}
