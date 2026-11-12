import { Label as LabelPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '../../lib/utils';

/** The visible label of a field, always above it. */
function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn(
        'flex items-center gap-2 text-body-sm leading-snug font-semibold text-ink select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-45',
        className,
      )}
      {...props}
    />
  );
}

export { Label };
