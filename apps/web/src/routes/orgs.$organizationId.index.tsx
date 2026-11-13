import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { buttonVariants } from '../components/ui/button';
import { PageHeader } from '../components/ui/page-header';
import { LlmUsageCard } from '../features/llm/LlmUsageCard';
import { OrganizationLimits } from '../features/organizations/OrganizationLimits';
import { OrganizationSettings } from '../features/organizations/OrganizationSettings';
import { PingPanel } from '../features/ping/PingPanel';
import { ROLE_LABELS } from '../features/organizations/OrganizationSwitcher';
import { sessionQuery } from '../features/session/session';

export const Route = createFileRoute('/orgs/$organizationId/')({
  component: OrganizationHome,
});

function OrganizationHome() {
  const { organizationId } = Route.useParams();
  const session = useQuery(sessionQuery);
  const organization = session.data?.organizations.find((item) => item.id === organizationId);

  return (
    <div className="grid w-full gap-8">
      <PageHeader
        title={organization?.name ?? 'Organización'}
        description={
          organization &&
          `${organization.isPersonal ? 'Organización personal' : 'Organización'} · Tu rol: ${ROLE_LABELS[organization.role]}`
        }
        action={
          <Link
            to="/orgs/$organizationId/members"
            params={{ organizationId }}
            className={buttonVariants({ variant: 'secondary' })}
          >
            Miembros
          </Link>
        }
      />
      <OrganizationSettings organizationId={organizationId} />
      <OrganizationLimits organizationId={organizationId} />
      <LlmUsageCard organizationId={organizationId} />
      <PingPanel organizationId={organizationId} />
    </div>
  );
}
