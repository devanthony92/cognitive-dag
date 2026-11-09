import { createFileRoute } from '@tanstack/react-router';
import { RegisterForm } from '../features/auth/RegisterForm';
import { requireGuest } from '../features/session/guards';

export const Route = createFileRoute('/register')({
  // For visitors only: a signed-in user is sent to their organization.
  beforeLoad: ({ context }) => requireGuest(context.queryClient),
  component: RegisterForm,
});
