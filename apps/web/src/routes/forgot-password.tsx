import { createFileRoute } from '@tanstack/react-router';
import { ForgotPasswordForm } from '../features/auth/PasswordResetForms';
import { requireIdentity } from '../features/session/guards';

export const Route = createFileRoute('/forgot-password')({
  // With identity-enabled off the screen does not exist for the user (FR-033).
  beforeLoad: ({ context }) => requireIdentity(context.queryClient),
  component: ForgotPasswordForm,
});
