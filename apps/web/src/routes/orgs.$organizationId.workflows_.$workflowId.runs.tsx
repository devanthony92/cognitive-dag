import { createFileRoute } from '@tanstack/react-router';
import { RunsPage } from '../features/runs/RunsPage';

export const Route = createFileRoute('/orgs/$organizationId/workflows_/$workflowId/runs')({
  staticData: { width: 'full' },
  component: Runs,
});

function Runs() {
  const { organizationId, workflowId } = Route.useParams();
  return <RunsPage organizationId={organizationId} workflowId={workflowId} />;
}
