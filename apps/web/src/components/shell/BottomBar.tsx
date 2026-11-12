import type { Role } from '@cognitive-dag/contracts';
import { ApprovalsBadge } from '../../features/approvals/ApprovalsBadge';
import { NavItem, destinationsFor } from './nav';

/** Bottom bar under 768 px: 56 px, one destination per column, above the device's safe area. */
export function BottomBar({ organizationId, role }: { organizationId: string; role: Role }) {
  return (
    <nav
      aria-label="Navegación inferior"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-ground px-1 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {destinationsFor(role).map((destination) =>
        destination.key === 'approvals' ? (
          <ApprovalsBadge key={destination.key} organizationId={organizationId} layout="bottom" />
        ) : (
          <NavItem
            key={destination.key}
            destination={destination}
            organizationId={organizationId}
            layout="bottom"
          />
        ),
      )}
    </nav>
  );
}
