import { createFileRoute } from '@tanstack/react-router';
import { ChangePasswordForm } from '../features/account/ChangePasswordForm';
import { requireSession } from '../features/session/guards';

export const Route = createFileRoute('/account/password')({
  beforeLoad: ({ context }) => requireSession(context.queryClient),
  component: ChangePasswordForm,
});
