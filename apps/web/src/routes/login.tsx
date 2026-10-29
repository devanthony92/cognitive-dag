import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { LoginForm } from '../features/auth/LoginForm';
import { homeRedirect, requireIdentity } from '../features/session/guards';
import { rememberSession, sessionQuery } from '../features/session/session';

export const Route = createFileRoute('/login')({
  beforeLoad: async ({ context }) => {
    await requireIdentity(context.queryClient);
    const info = await context.queryClient.fetchQuery(sessionQuery);
    if (info) throw homeRedirect(info);
  },
  component: LoginPage,
});

function LoginPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return (
    <LoginForm
      onLoggedIn={(info) => {
        rememberSession(queryClient, info);
        const first = info.organizations[0];
        void navigate(
          first
            ? { to: '/orgs/$organizationId', params: { organizationId: first.id } }
            : { to: '/' },
        );
      }}
    />
  );
}
