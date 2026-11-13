/**
 * Classes that turn a `Table` into a stack of labelled rows under `sm` (640 px): the header stays for
 * screen readers, each row becomes a block and each cell a line. One DOM, no hidden duplicates, so a
 * list reads at 375 px without scrolling sideways.
 */
export const STACKED = {
  head: 'max-sm:sr-only',
  row: 'max-sm:block max-sm:h-auto max-sm:px-3 max-sm:py-2',
  cell: 'max-sm:block max-sm:px-0 max-sm:py-0.5 max-sm:whitespace-normal',
} as const;
