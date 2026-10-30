import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { AcceptInvitationPanel } from '../features/invitations/AcceptInvitationPanel';
import { readPendingInvitation, rememberPendingInvitation } from '../features/invitations/pending';
import { requireIdentity } from '../features/session/guards';

export const Route = createFileRoute('/invitations/accept')({
  validateSearch: z.object({ token: z.string().optional().catch(undefined) }),
  beforeLoad: ({ context }) => requireIdentity(context.queryClient),
  component: AcceptInvitationPage,
});

function AcceptInvitationPage() {
  const { token } = Route.useSearch();
  const navigate = Route.useNavigate();
  // The link's token wins; after signing in or registering the page is reopened without one and
  // takes the invitation the person was in the middle of.
  const [captured] = useState(token ?? readPendingInvitation()?.token);
  useEffect(() => {
    if (token === undefined) return;
    rememberPendingInvitation({ token });
    // Removed from the address bar, history and Referer right away.
    void navigate({ search: {}, replace: true });
  }, [token, navigate]);

  return <AcceptInvitationPanel token={captured} />;
}
