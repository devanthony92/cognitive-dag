import type { Role } from '@cognitive-dag/contracts';
import { ApprovalsBadge } from '../../features/approvals/ApprovalsBadge';
import { NavItem, destinationsFor } from './nav';

/** Left rail: 240 px from 1024 px, 72 px (glyph over label) from 768 px; below that the bottom bar is used. */
export function NavRail({ organizationId, role }: { organizationId: string; role: Role }) {
  return (
    <nav
      aria-label="Navegación principal"
      className="sticky top-14 hidden h-[calc(100dvh-var(--header-height))] w-(--rail-width-compact) shrink-0 flex-col gap-1 overflow-y-auto border-r border-line bg-ground p-2 md:flex lg:w-(--rail-width) lg:p-3"
    >
      {destinationsFor(role).map((destination) =>
        destination.key === 'approvals' ? (
          <ApprovalsBadge key={destination.key} organizationId={organizationId} layout="rail" />
        ) : (
          <NavItem
            key={destination.key}
            destination={destination}
            organizationId={organizationId}
            layout="rail"
          />
        ),
      )}
    </nav>
  );
}
