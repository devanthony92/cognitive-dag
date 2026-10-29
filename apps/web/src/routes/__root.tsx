import type { QueryClient } from '@tanstack/react-query';
import { Link, Outlet, createRootRouteWithContext } from '@tanstack/react-router';

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <div className="min-h-screen">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center px-4 py-3">
          <Link to="/" className="font-semibold tracking-tight">
            CognitiveDAG
          </Link>
        </div>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col items-center px-4 py-10">
        <Outlet />
      </main>
    </div>
  );
}
