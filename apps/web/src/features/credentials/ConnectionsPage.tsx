import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { PageHeader } from '../../components/ui/page-header';
import { HttpHostsSection } from '../http-hosts/HttpHostsSection';
import { sessionQuery } from '../session/session';
import { CredentialsSection } from './CredentialsSection';

/** Credentials and allowlist of destinations, the two things `http.request` nodes depend on. */
export function ConnectionsPage({ organizationId }: { organizationId: string }) {
  const session = useQuery(sessionQuery);
  const role = session.data?.organizations.find((item) => item.id === organizationId)?.role;
  const isOwner = role === 'owner';

  if (role === 'viewer') {
    return (
      <div className="grid gap-6">
        <PageHeader
          title="Conexiones"
          description="Las credenciales y los destinos permitidos de las llamadas HTTP."
        />
        <Alert>
          <AlertDescription>Tu rol no permite ver las conexiones.</AlertDescription>
        </Alert>
      </div>
    );
  }
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Conexiones"
        description={
          isOwner
            ? 'Administra las credenciales y los destinos permitidos de las llamadas HTTP.'
            : 'Solo los owners pueden cambiar las credenciales y los destinos permitidos.'
        }
      />
      <CredentialsSection organizationId={organizationId} isOwner={isOwner} />
      <HttpHostsSection organizationId={organizationId} isOwner={isOwner} />
    </div>
  );
}
