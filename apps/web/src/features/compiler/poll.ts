/** First wait between two reads of a compilation in progress. */
export const POLL_FIRST_MS = 1_000;
/** The wait grows by half each time until it reaches this ceiling (F6, research R2). */
export const POLL_MAX_MS = 5_000;

/** Wait before the next read, given how many reads already happened: 1 s, 1.5 s, 2.25 s … 5 s. */
export function pollDelay(reads: number): number {
  const delay = POLL_FIRST_MS * 1.5 ** Math.max(0, reads - 1);
  return Math.min(POLL_MAX_MS, Math.round(delay));
}
