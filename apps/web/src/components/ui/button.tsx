import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * Buttons of the design: 44 px tall, 8 px radius. The primary one is inverted ink and there is one per
 * view (The One Action Rule); danger is an outline in the failed token, never a fill. The focus ring is
 * the double ring of `index.css` (`:focus-visible`). A disabled button is dimmed to 45 % and shows
 * `not-allowed`, so it still receives the pointer.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-transparent text-body font-semibold whitespace-nowrap transition-colors duration-(--duration-state) ease-line outline-none disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:cursor-not-allowed aria-disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: 'bg-action text-on-action hover:bg-action/90',
        secondary: 'border-line bg-surface text-ink hover:bg-raised',
        danger: 'border-state-failed bg-transparent text-state-failed hover:bg-raised',
        ghost: 'text-ink hover:bg-raised',
        link: 'h-auto min-h-11 px-0 text-ink underline underline-offset-4 hover:text-ink-muted',
      },
      size: {
        default: 'h-11 px-5',
        sm: 'h-11 px-4',
        icon: 'size-11',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-variant={variant ?? 'primary'}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
