import { createFileRoute } from '@tanstack/react-router';
import { WorkflowEditor } from '../features/workflows/WorkflowEditor';

export const Route = createFileRoute('/orgs/$organizationId/workflows/$workflowId')({
  // The canvas needs the whole window, not the narrow column of the other screens.
  staticData: { width: 'full' },
  component: Editor,
});

function Editor() {
  const { organizationId, workflowId } = Route.useParams();
  return <WorkflowEditor organizationId={organizationId} workflowId={workflowId} />;
}
