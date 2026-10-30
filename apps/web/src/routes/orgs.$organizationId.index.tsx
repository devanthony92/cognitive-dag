import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { buttonVariants } from '../components/ui/button';
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
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">{organization?.name}</h1>
        {organization && (
          <p className="text-muted-foreground">
            {organization.isPersonal ? 'Organización personal' : 'Organización'} · Tu rol:{' '}
            {ROLE_LABELS[organization.role]}
          </p>
        )}
        <Link
          to="/orgs/$organizationId/members"
          params={{ organizationId }}
          className={buttonVariants({ variant: 'outline', className: 'mt-4' })}
        >
          Miembros
        </Link>
      </section>
      <PingPanel organizationId={organizationId} />
    </div>
  );
}
