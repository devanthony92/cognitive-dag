import { Skeleton } from '../ui/skeleton';

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
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <div className="mt-4 grid gap-3">
        <Skeleton className="h-13 w-full" />
        <Skeleton className="h-13 w-full" />
        <Skeleton className="h-13 w-full" />
      </div>
    </div>
  );
}
