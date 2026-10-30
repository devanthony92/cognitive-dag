import { createFileRoute } from '@tanstack/react-router';
import { ForgotPasswordForm } from '../features/auth/PasswordResetForms';
import { requireGuest } from '../features/session/guards';

export const Route = createFileRoute('/forgot-password')({
  // Hidden with identity-enabled off (FR-033) and for signed-in users.
  beforeLoad: ({ context }) => requireGuest(context.queryClient),
  component: ForgotPasswordForm,
});
