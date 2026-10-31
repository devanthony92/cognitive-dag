import { createFileRoute } from '@tanstack/react-router';
import { requireExecution } from '../features/session/guards';
import { RunsPage } from '../features/runs/RunsPage';

export const Route = createFileRoute('/orgs/$organizationId/workflows_/$workflowId/runs')({
  beforeLoad: ({ context, params }) => requireExecution(context.queryClient, params.organizationId),
  staticData: { fullWidth: true },
  component: Runs,
});

function Runs() {
  const { organizationId, workflowId } = Route.useParams();
  return <RunsPage organizationId={organizationId} workflowId={workflowId} />;
}
