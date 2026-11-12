import { useQuery } from '@tanstack/react-query';
import { DESTINATIONS, NavItem, type NavLayout } from '../../components/shell/nav';
import { approvalCountQuery } from './api';

const APPROVALS = DESTINATIONS.find((destination) => destination.key === 'approvals')!;

/**
 * Navigation item to the inbox, with the count of what the person can decide (F7). It asks again every
 * 30 seconds; if the count cannot be read, the link stays and the number is left out.
 */
export function ApprovalsBadge({
  organizationId,
  layout = 'rail',
}: {
  organizationId: string;
  layout?: NavLayout;
}) {
  const count = useQuery(approvalCountQuery(organizationId));
  const pending = count.data?.pending ?? 0;
  return (
    <NavItem
      destination={APPROVALS}
      organizationId={organizationId}
      layout={layout}
      ariaLabel={pending > 0 ? `Aprobaciones, ${pending} pendientes` : 'Aprobaciones'}
      badge={
        pending > 0 ? (
          <span
            data-testid="approvals-count"
            className="tabular absolute -top-2 left-3 inline-flex min-w-5 items-center justify-center rounded-station bg-action px-1.5 text-label font-semibold text-on-action"
          >
            {pending}
          </span>
        ) : undefined
      }
    />
  );
}
