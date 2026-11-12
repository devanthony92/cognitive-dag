import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { setApiEventHandlers } from './api/client';
import { forgetSession, sessionQuery } from './features/session/session';
import { resetRouteRetries } from './components/route/RouteError';
import { routerDefaults } from './components/route/router-defaults';
import { initTheme } from './lib/theme';
import { routeTree } from './routeTree.gen';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

initTheme();

const router = createRouter({ routeTree, context: { queryClient }, ...routerDefaults });

// A navigation that ends without error starts the retry count of the next outage from zero.
router.subscribe('onResolved', () => {
  if (!router.state.matches.some((match) => match.status === 'error')) resetRouteRetries();
});

// A 401 anywhere means the session is gone (expired, revoked, Valkey emptied): back to login.
setApiEventHandlers({
  onUnauthenticated: () => {
    forgetSession(queryClient);
    void router.navigate({ to: '/login' });
  },
  // The membership was removed: refresh the organizations and land on another one (FR-025).
  onOrganizationLost: () => {
    void queryClient
      .invalidateQueries({ queryKey: sessionQuery.queryKey })
      .then(() => router.navigate({ to: '/' }));
  },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
