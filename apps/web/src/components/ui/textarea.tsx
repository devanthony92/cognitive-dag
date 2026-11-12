import type * as React from 'react';
import { cn } from '../../lib/utils';
import { FIELD_CLASS } from './field';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea className={cn('flex min-h-11 py-2.5', FIELD_CLASS, className)} {...props} />;
}

export { Textarea };
