import { cva, type VariantProps } from 'class-variance-authority';
import { Info } from 'lucide-react';
import type * as React from 'react';
import { cn } from '../../lib/utils';
import { StatusGlyph, STATE_TEXT_CLASS, type ServiceState } from '../status/statusGlyphs';

/**
 * A notice inside the page. The tone is the border plus a glyph plus the text, never the colour alone:
 * `destructive` reads as failed, `success` as completed, `warning` as waiting; `default` is neutral.
 */
const alertVariants = cva(
  'relative flex w-full items-start gap-3 rounded-lg border p-4 text-body',
  {
    variants: {
      variant: {
        default: 'border-line bg-surface text-ink',
        destructive: 'border-state-failed bg-surface text-ink',
        success: 'border-state-succeeded bg-surface text-ink',
        warning: 'border-state-waiting bg-surface text-ink',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

const GLYPH_STATE: Record<'destructive' | 'success' | 'warning', ServiceState> = {
  destructive: 'failed',
  success: 'succeeded',
  warning: 'waiting',
};

function Alert({
  className,
  variant,
  children,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  const state = variant && variant !== 'default' ? GLYPH_STATE[variant] : undefined;
  return (
    <div role="alert" className={cn(alertVariants({ variant }), className)} {...props}>
      {state ? (
        <StatusGlyph state={state} className={cn('mt-0.5 size-5', STATE_TEXT_CLASS[state])} />
      ) : (
        <Info className="mt-0.5 size-5 shrink-0 text-ink-muted" aria-hidden />
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('mb-1 font-semibold', className)} {...props} />;
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('text-body-sm [&_p]:leading-relaxed', className)} {...props} />;
}

export { Alert, AlertDescription, AlertTitle };
