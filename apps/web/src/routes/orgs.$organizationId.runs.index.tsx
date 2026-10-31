import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { RunStatusSchema } from '@cognitive-dag/contracts';
import { OrganizationRunsPage } from '../features/runs/OrganizationRunsPage';
import { requireResilience } from '../features/session/guards';

export const Route = createFileRoute('/orgs/$organizationId/runs/')({
  // Filters live in the address so a filtered list can be shared and survives a reload.
  validateSearch: z.object({
    status: RunStatusSchema.optional().catch(undefined),
    workflowId: z.uuid().optional().catch(undefined),
  }),
  beforeLoad: ({ context, params }) =>
    requireResilience(context.queryClient, params.organizationId),
  staticData: { fullWidth: true },
  component: OrganizationRuns,
});

function OrganizationRuns() {
  const { organizationId } = Route.useParams();
  const { status, workflowId } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <OrganizationRunsPage
      organizationId={organizationId}
      filters={{ status, workflowId }}
      onFiltersChange={(next) =>
        void navigate({ search: { status: next.status, workflowId: next.workflowId } })
      }
    />
  );
}
