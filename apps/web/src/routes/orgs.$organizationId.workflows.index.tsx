import { createFileRoute } from '@tanstack/react-router';
import { WorkflowsPage } from '../features/workflows/WorkflowsPage';

export const Route = createFileRoute('/orgs/$organizationId/workflows/')({
  component: Workflows,
});

function Workflows() {
  const { organizationId } = Route.useParams();
  return <WorkflowsPage organizationId={organizationId} />;
}
