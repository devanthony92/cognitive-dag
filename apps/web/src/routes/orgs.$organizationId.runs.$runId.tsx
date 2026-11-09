import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { RunDetailPage } from '../features/runs/RunDetailPage';

export const Route = createFileRoute('/orgs/$organizationId/runs/$runId')({
  // `node` opens the panel of a node: the link of a reused node to where it actually ran.
  validateSearch: z.object({ node: z.string().optional().catch(undefined) }),
  // The graph needs the whole window, like the editor.
  staticData: { fullWidth: true },
  component: RunDetail,
});

function RunDetail() {
  const { organizationId, runId } = Route.useParams();
  const { node } = Route.useSearch();
  // A new run (rerun) starts from a clean screen.
  return (
    <RunDetailPage key={runId} organizationId={organizationId} runId={runId} initialNodeId={node} />
  );
}
