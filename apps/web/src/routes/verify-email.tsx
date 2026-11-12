import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { VerifyEmailPanel } from '../features/auth/VerifyEmailPanel';

export const Route = createFileRoute('/verify-email')({
  staticData: { width: 'narrow' },
  validateSearch: z.object({ token: z.string().optional().catch(undefined) }),
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const { token } = Route.useSearch();
  const navigate = Route.useNavigate();
  // The token is kept in memory and removed from the address bar, history and Referer right away.
  const [captured] = useState(token);
  useEffect(() => {
    if (token !== undefined) void navigate({ search: {}, replace: true });
  }, [token, navigate]);

  return <VerifyEmailPanel token={captured} />;
}
