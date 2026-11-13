import { createFileRoute } from '@tanstack/react-router';
import { MembersPage } from '../features/members/MembersPage';

export const Route = createFileRoute('/orgs/$organizationId/members')({
  staticData: { width: 'default' },
  component: Members,
});

function Members() {
  const { organizationId } = Route.useParams();
  return <MembersPage organizationId={organizationId} />;
}
