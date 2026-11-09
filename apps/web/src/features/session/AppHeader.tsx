import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Button, buttonVariants } from '../../components/ui/button';
import { ApprovalsBadge } from '../approvals/ApprovalsBadge';
import { OrganizationSwitcher } from '../organizations/OrganizationSwitcher';
import { forgetSession, logout, sessionQuery } from './session';

/** Top bar: brand, organization switcher and sign-out once there is a session. */
export function AppHeader() {
  const session = useQuery(sessionQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { organizationId } = useParams({ strict: false });

  const signOut = useMutation({
    mutationFn: logout,
    // Even if the call fails (the session was already gone) the browser must forget it.
    onSettled: async () => {
      forgetSession(queryClient);
      await navigate({ to: '/login' });
    },
  });

  const info = session.data;

  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 whitespace-nowrap">
        <Link to="/" className="font-semibold tracking-tight">
          CognitiveDAG
        </Link>
        {info && (
          <OrganizationSwitcher
            organizations={info.organizations}
            activeId={organizationId}
            onSelect={(id) =>
              void navigate({ to: '/orgs/$organizationId', params: { organizationId: id } })
            }
          />
        )}
        {info && organizationId !== undefined && (
          <Link
            to="/orgs/$organizationId/workflows"
            params={{ organizationId }}
            className="text-sm underline"
          >
            Workflows
          </Link>
        )}
        {info && organizationId !== undefined && (
          <Link
            to="/orgs/$organizationId/runs"
            params={{ organizationId }}
            className="text-sm underline"
          >
            Ejecuciones
          </Link>
        )}
        {info &&
          organizationId !== undefined &&
          info.organizations.some(
            (organization) => organization.id === organizationId && organization.role !== 'viewer',
          ) && (
            <>
              <ApprovalsBadge organizationId={organizationId} />
              <Link
                to="/orgs/$organizationId/connections"
                params={{ organizationId }}
                className="text-sm underline"
              >
                Conexiones
              </Link>
            </>
          )}
        {info && organizationId !== undefined && (
          <Link
            to="/orgs/$organizationId/members"
            params={{ organizationId }}
            className="text-sm underline"
          >
            Miembros
          </Link>
        )}
        <div className="ml-auto flex min-w-0 items-center gap-3 text-sm whitespace-nowrap">
          {info && (
            <>
              <span className="min-w-0 truncate text-muted-foreground" title={info.user.name}>
                {info.user.name}
              </span>
              <Link to="/account/password" className="underline">
                Contraseña
              </Link>
              <Button
                variant="outline"
                onClick={() => signOut.mutate()}
                disabled={signOut.isPending}
              >
                Cerrar sesión
              </Button>
            </>
          )}
          {session.isSuccess && !info && (
            <Link to="/login" className={buttonVariants({ variant: 'outline' })}>
              Iniciar sesión
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
