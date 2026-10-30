import { createFileRoute } from '@tanstack/react-router';
import { WorkflowsPage } from '../features/workflows/WorkflowsPage';
import { requireDagEditor } from '../features/session/guards';

export const Route = createFileRoute('/orgs/$organizationId/workflows/')({
  beforeLoad: ({ context, params }) => requireDagEditor(context.queryClient, params.organizationId),
  component: Workflows,
});

function Workflows() {
  const { organizationId } = Route.useParams();
  return <WorkflowsPage organizationId={organizationId} />;
}
