import { cn } from '../../lib/utils';

function Bar({ className }: { className: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-raised', className)} />;
}

/**
 * `defaultPendingComponent`, shown by the router only after 150 ms. The skeleton has the height of a
 * typical screen so what replaces it does not move the layout; `role="status"` announces it.
 */
export function RoutePending() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto grid min-h-[28rem] w-full max-w-page-default content-start gap-4 px-4 py-6 sm:px-6 md:py-8"
    >
      <span className="sr-only">Cargando</span>
      <Bar className="h-8 w-1/3" />
      <Bar className="h-4 w-2/3" />
      <div className="mt-4 grid gap-3">
        <Bar className="h-13 w-full" />
        <Bar className="h-13 w-full" />
        <Bar className="h-13 w-full" />
      </div>
    </div>
  );
}
