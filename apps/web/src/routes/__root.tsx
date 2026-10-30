import type { QueryClient } from '@tanstack/react-query';
import { Outlet, createRootRouteWithContext, useMatches } from '@tanstack/react-router';
import { AppHeader } from '../features/session/AppHeader';

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /** The screen uses the whole window instead of the centered column. */
    fullWidth?: boolean;
  }
}

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  const fullWidth = useMatches({
    select: (matches) => matches.some((match) => match.staticData.fullWidth === true),
  });
  return (
    <div className="min-h-screen">
      <AppHeader />
      {fullWidth ? (
        <main>
          <Outlet />
        </main>
      ) : (
        <main className="mx-auto flex max-w-3xl flex-col items-center px-4 py-10">
          <Outlet />
        </main>
      )}
    </div>
  );
}
