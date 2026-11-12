import type * as React from 'react';
import { cn } from '../../lib/utils';
import { FIELD_CLASS } from './field';

/** A native `<select>` dressed like `Input`: keyboard and screen reader support for free. */
function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return <select className={cn('flex h-11', FIELD_CLASS, className)} {...props} />;
}

export { NativeSelect };
