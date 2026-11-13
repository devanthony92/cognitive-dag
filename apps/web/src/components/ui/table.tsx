import type * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * A table of the design: the wrapper contains the overflow, so a wide table scrolls inside its own box
 * and never makes the document scroll sideways. `flush` is for a table inside a card. Rows are 52 px, the header is a Label, figures that
 * change (durations, counters) are tabular and aligned to the right with `numeric`.
 */
function Table({
  className,
  flush = false,
  ...props
}: React.ComponentProps<'table'> & { flush?: boolean }) {
  return (
    <div
      className={cn(
        'relative w-full max-w-full overflow-x-auto',
        // Inside a card the table drops its own box so a panel never holds another panel.
        flush ? 'border-t border-line' : 'rounded-lg border border-line bg-surface',
      )}
    >
      <table className={cn('w-full caption-bottom text-body', className)} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead className={cn('border-b border-line [&_tr]:h-11', className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      className={cn(
        'h-13 border-b border-line transition-colors duration-(--duration-state) hover:bg-raised',
        className,
      )}
      {...props}
    />
  );
}

function TableHead({
  className,
  numeric = false,
  ...props
}: React.ComponentProps<'th'> & { numeric?: boolean }) {
  return (
    <th
      className={cn(
        'h-11 px-3 text-left align-middle text-label font-semibold tracking-[0.06em] whitespace-nowrap text-ink-muted uppercase',
        numeric && 'text-right tabular-nums',
        className,
      )}
      {...props}
    />
  );
}

function TableCell({
  className,
  numeric = false,
  ...props
}: React.ComponentProps<'td'> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        'px-3 py-2 align-middle whitespace-nowrap',
        numeric && 'text-right tabular-nums',
        className,
      )}
      {...props}
    />
  );
}

export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow };
