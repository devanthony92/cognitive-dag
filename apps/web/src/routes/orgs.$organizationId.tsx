import { Outlet, createFileRoute } from '@tanstack/react-router';
import { homeRedirect, requireSession } from '../features/session/guards';

export const Route = createFileRoute('/orgs/$organizationId')({
  // Protected area: needs a session, and the organization must be one of the user's. A removed
  // membership lands on another organization instead of an error page (FR-025).
  beforeLoad: async ({ context, params }) => {
    const info = await requireSession(context.queryClient);
    if (!info.organizations.some((organization) => organization.id === params.organizationId)) {
      throw homeRedirect(info);
    }
    return { organizations: info.organizations };
  },
  component: Outlet,
});
