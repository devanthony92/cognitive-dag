import { createFileRoute } from '@tanstack/react-router';
import { ForgotPasswordForm } from '../features/auth/PasswordResetForms';
import { requireGuest } from '../features/session/guards';

export const Route = createFileRoute('/forgot-password')({
  staticData: { width: 'narrow' },
  // For visitors only: a signed-in user is sent to their organization.
  beforeLoad: ({ context }) => requireGuest(context.queryClient),
  component: ForgotPasswordForm,
});
