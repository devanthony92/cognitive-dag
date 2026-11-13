import { Dialog as DialogPrimitive } from 'radix-ui';
import { XIcon } from 'lucide-react';
import type * as React from 'react';
import { cn } from '../../lib/utils';

const Sheet = DialogPrimitive.Root;
const SheetClose = DialogPrimitive.Close;

/**
 * A bottom sheet: the dialog of a phone, anchored to the bottom edge, at most 85 % of the screen tall
 * and scrolling inside. Same Radix dialog underneath, so the focus is trapped and returned and Esc
 * closes it. It needs a `SheetTitle`, which names it for assistive technology.
 */
function SheetContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ground/70 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 grid max-h-[85dvh] gap-4 overflow-y-auto rounded-t-lg border-t border-line bg-raised p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-ink shadow-float duration-(--duration-panel) data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom',
          className,
        )}
        {...props}
      >
        <div aria-hidden="true" className="mx-auto h-1 w-10 rounded-station bg-line-strong" />
        {children}
        <DialogPrimitive.Close className="absolute top-2 right-2 flex size-11 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-surface hover:text-ink">
          <XIcon className="size-4" />
          <span className="sr-only">Cerrar</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title className={cn('pr-10 text-title font-semibold', className)} {...props} />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('text-body-sm text-ink-muted', className)}
      {...props}
    />
  );
}

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle };
