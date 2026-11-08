import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { ApprovalsPage } from '../features/approvals/ApprovalsPage';

export const Route = createFileRoute('/orgs/$organizationId/approvals')({
  // The detail opens from the email link: `?approval=<id>`.
  validateSearch: z.object({ approval: z.uuid().optional().catch(undefined) }),
  component: Approvals,
});

function Approvals() {
  const { organizationId } = Route.useParams();
  const { approval } = Route.useSearch();
  return <ApprovalsPage organizationId={organizationId} selectedId={approval} />;
}
