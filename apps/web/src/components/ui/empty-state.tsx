import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * An empty list: plain Spanish text and one action. It lives inside the width of its page
 * (`page-default`), so it sets no width of its own. `titleAs` keeps the heading order of the page.
 */
export function EmptyState({
  title,
  description,
  action,
  icon: Icon,
  titleAs: Title = 'h2',
  className,
}: {
  title: string;
  description?: ReactNode;
  /** The one action that fills the list, usually a button or a link. */
  action?: ReactNode;
  icon?: LucideIcon;
  titleAs?: 'h2' | 'h3';
  className?: string;
}) {
  return (
    <section
      className={cn(
        'flex flex-col items-center gap-3 rounded-lg border border-dashed border-line-strong px-4 py-12 text-center',
        className,
      )}
    >
      {Icon && <Icon className="size-8 text-ink-muted" strokeWidth={2} aria-hidden />}
      <Title className="text-title font-semibold text-ink">{title}</Title>
      {description && <p className="max-w-prose text-body text-ink-muted">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </section>
  );
}
