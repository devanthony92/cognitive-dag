import { createFileRoute } from '@tanstack/react-router';
import { requireDagEditor } from '../features/session/guards';
import { WorkflowEditor } from '../features/workflows/WorkflowEditor';

export const Route = createFileRoute('/orgs/$organizationId/workflows/$workflowId')({
  beforeLoad: ({ context, params }) => requireDagEditor(context.queryClient, params.organizationId),
  // The canvas needs the whole window, not the narrow column of the other screens.
  staticData: { fullWidth: true },
  component: Editor,
});

function Editor() {
  const { organizationId, workflowId } = Route.useParams();
  return <WorkflowEditor organizationId={organizationId} workflowId={workflowId} />;
}
