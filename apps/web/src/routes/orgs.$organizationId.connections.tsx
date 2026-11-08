import { createFileRoute } from '@tanstack/react-router';
import { ConnectionsPage } from '../features/credentials/ConnectionsPage';

export const Route = createFileRoute('/orgs/$organizationId/connections')({
  component: Connections,
});

function Connections() {
  const { organizationId } = Route.useParams();
  return <ConnectionsPage organizationId={organizationId} />;
}
