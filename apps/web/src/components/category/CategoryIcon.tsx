import { cn } from '../../lib/utils';
import { CATEGORIES, categoryOfType, type CategoryId } from './categories';

/**
 * Pictogram of a node category: 24 px, 2 px stroke, in the colour of its line. The label travels with
 * it (visible with `showLabel`, otherwise for assistive technology), so category never relies on
 * colour alone. Pass a catalog `type` (`llm.classify`) or a category id.
 */
export function CategoryIcon({
  type,
  category,
  showLabel = false,
  className,
}: {
  type?: string;
  category?: CategoryId;
  showLabel?: boolean;
  className?: string;
}) {
  const id = category ?? (type === undefined ? undefined : categoryOfType(type));
  if (id === undefined) return null;
  const { Icon, label, textClass } = CATEGORIES[id];
  return (
    <span className={cn('inline-flex items-center gap-2', textClass, className)} data-category={id}>
      <Icon className="size-6 shrink-0" strokeWidth={2} aria-hidden />
      <span className={cn(showLabel ? 'text-body-sm font-semibold text-ink' : 'sr-only')}>
        {label}
      </span>
    </span>
  );
}
