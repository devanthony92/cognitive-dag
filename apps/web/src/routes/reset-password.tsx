import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { ResetPasswordForm } from '../features/auth/PasswordResetForms';

export const Route = createFileRoute('/reset-password')({
  staticData: { width: 'narrow' },
  validateSearch: z.object({ token: z.string().optional().catch(undefined) }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token } = Route.useSearch();
  const navigate = Route.useNavigate();
  // The token is kept in memory and removed from the address bar, history and Referer right away.
  const [captured] = useState(token);
  useEffect(() => {
    if (token !== undefined) void navigate({ search: {}, replace: true });
  }, [token, navigate]);

  return <ResetPasswordForm token={captured} />;
}
