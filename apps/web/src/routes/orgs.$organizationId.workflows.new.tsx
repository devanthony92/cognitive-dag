import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { EditorSkeleton } from '../components/route/EditorSkeleton';
import { CompilerPage } from '../features/compiler/CompilerPage';

export const Route = createFileRoute('/orgs/$organizationId/workflows/new')({
  // `workflowId` turns "describe a new workflow" into "regenerate the draft of this one".
  validateSearch: z.object({ workflowId: z.uuid().optional().catch(undefined) }),
  staticData: { width: 'default' },
  // The canvas chunk takes 1-3 s to arrive: show the editor skeleton at once instead of a blank screen.
  pendingComponent: EditorSkeleton,
  pendingMs: 0,
  component: Compiler,
});

function Compiler() {
  const { organizationId } = Route.useParams();
  const { workflowId } = Route.useSearch();
  return <CompilerPage organizationId={organizationId} workflowId={workflowId} />;
}
