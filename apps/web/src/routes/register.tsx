import { createFileRoute } from '@tanstack/react-router';
import { RegisterForm } from '../features/auth/RegisterForm';
import { requireGuest } from '../features/session/guards';

export const Route = createFileRoute('/register')({
  // Hidden with identity-enabled off (FR-033) and for signed-in users.
  beforeLoad: ({ context }) => requireGuest(context.queryClient),
  component: RegisterForm,
});
