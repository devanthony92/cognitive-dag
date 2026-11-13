import { cn } from '../../lib/utils';
import { Skeleton } from './skeleton';

/**
 * The loading state of a list: rows of the height they will have (52 px), announced once as a status.
 * It sits where the list will be, so what replaces it does not move the layout.
 */
export function RowsSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn('grid gap-2', className)}>
      <span className="sr-only">Cargando</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-13 w-full" />
      ))}
    </div>
  );
}
