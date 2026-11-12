import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * Header of a screen: the only `h1` of the page, an optional line below it and, at the right, the one
 * primary action of the view (The One Action Rule). On a narrow screen the action drops below.
 */
export function PageHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** The primary action of the view: one button or link. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-3', className)}>
      <div className="grid min-w-0 gap-1">
        <h1 className="text-headline font-bold text-ink">{title}</h1>
        {description && <p className="text-body text-ink-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
