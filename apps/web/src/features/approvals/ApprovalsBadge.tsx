import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { approvalCountQuery } from './api';

/**
 * Link of the top bar to the inbox, with the count of what the person can decide (F7). It asks
 * again every 30 seconds; if the count cannot be read, the link stays and the number is left out.
 */
export function ApprovalsBadge({ organizationId }: { organizationId: string }) {
  const count = useQuery(approvalCountQuery(organizationId));
  const pending = count.data?.pending ?? 0;
  return (
    <Link
      to="/orgs/$organizationId/approvals"
      params={{ organizationId }}
      className="text-sm underline"
      aria-label={pending > 0 ? `Aprobaciones, ${pending} pendientes` : 'Aprobaciones'}
    >
      Aprobaciones
      {pending > 0 && (
        <span
          data-testid="approvals-count"
          className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground"
        >
          {pending}
        </span>
      )}
    </Link>
  );
}
