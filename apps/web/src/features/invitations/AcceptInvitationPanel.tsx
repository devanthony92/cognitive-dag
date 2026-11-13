import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import {
  InvitationPreviewSchema,
  OrganizationSummarySchema,
  type OrganizationSummary,
} from '@cognitive-dag/contracts';
import { ApiProblemError, request } from '../../api/client';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Button, buttonVariants } from '../../components/ui/button';
import { PageHeader } from '../../components/ui/page-header';
import { Skeleton } from '../../components/ui/skeleton';
import { ProblemAlert } from '../auth/ProblemAlert';
import { ROLE_LABELS } from '../organizations/OrganizationSwitcher';
import { sessionQuery } from '../session/session';
import { clearPendingInvitation, rememberPendingInvitation } from './pending';

/**
 * Shows who invited whom to what, and accepts it for the signed-in person. The token arrives as a
 * prop (the route removes it from the address bar) and travels in request bodies only.
 */
export function AcceptInvitationPanel({ token }: { token: string | undefined }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const session = useQuery(sessionQuery);

  const preview = useQuery({
    queryKey: ['invitation-preview', token],
    enabled: token !== undefined,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: async () =>
      (
        await request('/api/v1/invitations/preview', InvitationPreviewSchema, {
          method: 'POST',
          body: JSON.stringify({ token }),
        })
      ).data,
  });

  // Keep the invitation for the sign-in or registration that may follow in this or another tab.
  useEffect(() => {
    if (token !== undefined && preview.data) {
      rememberPendingInvitation({ token, email: preview.data.email });
    }
    if (
      preview.error instanceof ApiProblemError &&
      preview.error.problem.code === 'TOKEN_INVALID'
    ) {
      clearPendingInvitation();
    }
  }, [token, preview.data, preview.error]);

  const accept = useMutation<OrganizationSummary, Error>({
    mutationFn: async () =>
      (
        await request('/api/v1/invitations/accept', OrganizationSummarySchema, {
          method: 'POST',
          body: JSON.stringify({ token }),
        })
      ).data,
    onSuccess: async (organization) => {
      clearPendingInvitation();
      await queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey });
      await navigate({
        to: '/orgs/$organizationId/members',
        params: { organizationId: organization.id },
      });
    },
  });

  if (token === undefined || preview.isError) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Invitación no válida" />
        <Alert variant="destructive">
          <AlertTitle>No se puede usar este enlace</AlertTitle>
          <AlertDescription>
            <p>
              El enlace no es válido, ya fue usado o está vencido. Pide a un owner que te invite de
              nuevo.
            </p>
          </AlertDescription>
        </Alert>
        <div>
          <Link to="/" className={buttonVariants({ variant: 'secondary' })}>
            Ir al inicio
          </Link>
        </div>
      </div>
    );
  }

  const invitation = preview.data;
  if (!invitation || session.isPending) {
    return (
      <div className="grid gap-6">
        <PageHeader title="Invitación" />
        <div role="status" className="grid gap-3">
          <span className="sr-only">Cargando la invitación…</span>
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  const user = session.data?.user;
  const wrongAccount = user !== undefined && user.email !== invitation.email;

  return (
    <div className="grid gap-6">
      <PageHeader
        title={`Invitación a ${invitation.organizationName}`}
        description={
          <>
            Te invitaron como {ROLE_LABELS[invitation.role]}. La invitación es para{' '}
            <strong className="font-semibold text-ink">{invitation.email}</strong>.
          </>
        }
      />
      {user === undefined && (
        <Alert>
          <AlertDescription>
            Inicia sesión con {invitation.email} para aceptarla. Si todavía no tienes cuenta, créala
            con ese mismo correo: al verificarlo e iniciar sesión podrás aceptar.
          </AlertDescription>
        </Alert>
      )}
      {wrongAccount && (
        <Alert variant="destructive">
          <AlertDescription>
            Estás conectado como {user.email}. Cierra sesión y entra con {invitation.email}.
          </AlertDescription>
        </Alert>
      )}
      {accept.isError && <ProblemAlert error={accept.error} />}
      <div className="flex flex-wrap gap-3">
        {user === undefined ? (
          <>
            <Link to="/login" className={buttonVariants()}>
              Iniciar sesión
            </Link>
            <Link to="/register" className={buttonVariants({ variant: 'secondary' })}>
              Crear cuenta
            </Link>
          </>
        ) : (
          <Button onClick={() => accept.mutate()} disabled={wrongAccount || accept.isPending}>
            Aceptar invitación
          </Button>
        )}
      </div>
    </div>
  );
}
