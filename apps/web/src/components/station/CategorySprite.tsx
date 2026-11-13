import { CATEGORIES, CATEGORY_IDS, type CategoryId } from '../category/categories';

export const categorySymbolId = (category: CategoryId) => `station-icon-${category}`;

/**
 * The six category pictograms, drawn once as SVG symbols; every station points at its symbol with
 * `<use>` instead of carrying a full copy of the icon. Render it once inside each canvas.
 */
export function CategorySprite() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none absolute size-0 overflow-hidden"
    >
      {CATEGORY_IDS.map((id) => {
        const { Icon } = CATEGORIES[id];
        return (
          <symbol key={id} id={categorySymbolId(id)} viewBox="0 0 24 24">
            <Icon size={24} strokeWidth={2} />
          </symbol>
        );
      })}
    </svg>
  );
}
