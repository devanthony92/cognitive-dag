import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import {
  InvitationPreviewSchema,
  OrganizationSummarySchema,
  type OrganizationSummary,
} from '@cognitive-dag/contracts';
import { ApiProblemError, request } from '../../api/client';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button, buttonVariants } from '../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
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
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Invitación no válida</CardTitle>
          <CardDescription>
            El enlace no es válido, ya fue usado o está vencido. Pide a un owner que te invite de
            nuevo.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const invitation = preview.data;
  if (!invitation || session.isPending) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Invitación</CardTitle>
          <CardDescription>Cargando la invitación…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const user = session.data?.user;
  const wrongAccount = user !== undefined && user.email !== invitation.email;

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Invitación a {invitation.organizationName}</CardTitle>
        <CardDescription>
          Te invitaron como {ROLE_LABELS[invitation.role]}. La invitación es para{' '}
          <strong>{invitation.email}</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {user === undefined && (
          <Alert>
            <AlertDescription>
              Inicia sesión con {invitation.email} para aceptarla. Si todavía no tienes cuenta,
              créala con ese mismo correo: al verificarlo e iniciar sesión podrás aceptar.
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
      </CardContent>
      <CardFooter className="gap-2">
        {user === undefined ? (
          <>
            <Link to="/login" className={buttonVariants()}>
              Iniciar sesión
            </Link>
            <Link to="/register" className={buttonVariants({ variant: 'outline' })}>
              Crear cuenta
            </Link>
          </>
        ) : (
          <Button onClick={() => accept.mutate()} disabled={wrongAccount || accept.isPending}>
            Aceptar invitación
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
