import type * as React from 'react';
import { cn } from '../../lib/utils';
import { FIELD_CLASS } from './field';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return <input type={type} className={cn('flex h-11', FIELD_CLASS, className)} {...props} />;
}

export { Input };
