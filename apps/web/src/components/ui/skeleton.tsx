import type * as React from 'react';
import { cn } from '../../lib/utils';

/** A placeholder block in the shape of what will load. It pulses only when motion is allowed. */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn('rounded-md bg-raised motion-safe:animate-pulse', className)}
      {...props}
    />
  );
}

export { Skeleton };
