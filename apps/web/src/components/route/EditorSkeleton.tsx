import { cn } from '../../lib/utils';

function Ghost({ className }: { className: string }) {
  return <div aria-hidden className={cn('animate-pulse bg-raised', className)} />;
}

/**
 * Skeleton of the editor: page header, palette and a canvas with ghost stations. "Describir workflow"
 * shows it at once (no 150 ms delay) while the heavy chunk of the canvas loads, so the screen is never
 * blank. Same grid as the real page, so nothing jumps when it is replaced.
 */
export function EditorSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto grid min-h-[32rem] w-full max-w-page-default gap-4 px-4 py-6 sm:px-6 md:py-8"
    >
      <span className="sr-only">Cargando el editor</span>
      <Ghost className="h-8 w-2/5 rounded-md" />
      <Ghost className="h-4 w-3/5 rounded-md" />
      <div className="grid gap-4 md:grid-cols-[14rem_1fr]">
        <div className="hidden gap-3 md:grid">
          <Ghost className="h-11 rounded-md" />
          <Ghost className="h-11 rounded-md" />
          <Ghost className="h-11 rounded-md" />
        </div>
        <div className="relative min-h-72 rounded-lg border border-line bg-surface">
          <Ghost className="absolute top-12 left-10 size-10 rounded-station" />
          <Ghost className="absolute top-12 left-1/2 size-10 rounded-station" />
          <Ghost className="absolute right-10 bottom-12 size-10 rounded-station" />
        </div>
      </div>
    </div>
  );
}
