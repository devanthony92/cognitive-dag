import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { CompilerPage } from '../features/compiler/CompilerPage';

export const Route = createFileRoute('/orgs/$organizationId/workflows/new')({
  // `workflowId` turns "describe a new workflow" into "regenerate the draft of this one".
  validateSearch: z.object({ workflowId: z.uuid().optional().catch(undefined) }),
  component: Compiler,
});

function Compiler() {
  const { organizationId } = Route.useParams();
  const { workflowId } = Route.useSearch();
  return <CompilerPage organizationId={organizationId} workflowId={workflowId} />;
}
