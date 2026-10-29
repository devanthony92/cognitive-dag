import { createFileRoute, redirect } from '@tanstack/react-router';
import { RegisterForm } from '../features/auth/RegisterForm';
import { featuresQuery, isIdentityEnabled } from '../features/flags';

export const Route = createFileRoute('/register')({
  // With identity-enabled off the screen does not exist for the user (FR-033).
  beforeLoad: async ({ context }) => {
    const features = await context.queryClient.ensureQueryData(featuresQuery);
    if (!isIdentityEnabled(features)) throw redirect({ to: '/' });
  },
  component: RegisterForm,
});
