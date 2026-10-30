import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Button, buttonVariants } from '../../components/ui/button';
import { featuresQuery, isDagEditorEnabled, isIdentityEnabled } from '../flags';
import { OrganizationSwitcher } from '../organizations/OrganizationSwitcher';
import { forgetSession, logout, sessionQuery } from './session';

/** Top bar: brand, organization switcher and sign-out once there is a session. */
export function AppHeader() {
  const features = useQuery(featuresQuery);
  const identity = isIdentityEnabled(features.data);
  const session = useQuery({ ...sessionQuery, enabled: identity });
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
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
        <Link to="/" className="font-semibold tracking-tight">
          CognitiveDAG
        </Link>
        {identity && info && (
          <OrganizationSwitcher
            organizations={info.organizations}
            activeId={organizationId}
            onSelect={(id) =>
              void navigate({ to: '/orgs/$organizationId', params: { organizationId: id } })
            }
          />
        )}
        {identity && info && organizationId !== undefined && isDagEditorEnabled(features.data) && (
          <Link
            to="/orgs/$organizationId/workflows"
            params={{ organizationId }}
            className="text-sm underline"
          >
            Workflows
          </Link>
        )}
        {identity && info && organizationId !== undefined && (
          <Link
            to="/orgs/$organizationId/members"
            params={{ organizationId }}
            className="text-sm underline"
          >
            Miembros
          </Link>
        )}
        <div className="ml-auto flex items-center gap-3 text-sm">
          {identity && info && (
            <>
              <span className="text-muted-foreground">{info.user.name}</span>
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
          {identity && session.isSuccess && !info && (
            <Link to="/login" className={buttonVariants({ variant: 'outline' })}>
              Iniciar sesión
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
