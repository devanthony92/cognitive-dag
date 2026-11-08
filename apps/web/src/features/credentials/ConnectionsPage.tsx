import { useQuery } from '@tanstack/react-query';
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
      <div className="mx-auto w-full max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Conexiones</h1>
        <p className="text-muted-foreground">Tu rol no permite ver las conexiones.</p>
      </div>
    );
  }
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Conexiones</h1>
        <p className="text-muted-foreground">
          {isOwner
            ? 'Administra las credenciales y los destinos permitidos de las llamadas HTTP.'
            : 'Solo los owners pueden cambiar las credenciales y los destinos permitidos.'}
        </p>
      </section>
      <CredentialsSection organizationId={organizationId} isOwner={isOwner} />
      <HttpHostsSection organizationId={organizationId} isOwner={isOwner} />
    </div>
  );
}
