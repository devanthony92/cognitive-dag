import { createFileRoute } from '@tanstack/react-router';
import { requireExecution } from '../features/session/guards';
import { RunDetailPage } from '../features/runs/RunDetailPage';

export const Route = createFileRoute('/orgs/$organizationId/runs/$runId')({
  beforeLoad: ({ context, params }) => requireExecution(context.queryClient, params.organizationId),
  // The graph needs the whole window, like the editor.
  staticData: { fullWidth: true },
  component: RunDetail,
});

function RunDetail() {
  const { organizationId, runId } = Route.useParams();
  // A new run (rerun) starts from a clean screen.
  return <RunDetailPage key={runId} organizationId={organizationId} runId={runId} />;
}
