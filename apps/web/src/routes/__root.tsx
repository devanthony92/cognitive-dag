import type { QueryClient } from '@tanstack/react-query';
import {
  Link,
  Outlet,
  createRootRouteWithContext,
  useMatches,
  type ErrorComponentProps,
} from '@tanstack/react-router';
import { Page, type PageWidth } from '../components/route/Page';
import { RouteError } from '../components/route/RouteError';
import { AppShell } from '../components/shell/AppShell';
import { Logo } from '../components/shell/Logo';

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /** Width of the screen: a narrow column, the default column or the whole content area. */
    width?: PageWidth;
  }
}

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  errorComponent: RootError,
});

function RootLayout() {
  // The deepest route that states a width wins; without one the screen uses the default column.
  const width = useMatches({
    select: (matches) =>
      [...matches].reverse().find((match) => match.staticData.width !== undefined)?.staticData
        .width ?? 'default',
  });
  return (
    <AppShell>
      <Page width={width}>
        <Outlet />
      </Page>
    </AppShell>
  );
}

/**
 * Last resort: the root layout itself failed, so nothing that depends on the session or the shell can
 * be trusted. A bare frame with the brand and the same panel keeps the person oriented.
 */
function RootError(props: ErrorComponentProps) {
  return (
    <div className="min-h-dvh bg-ground text-ink">
      <header className="flex h-14 items-center gap-2 border-b border-line px-4">
        <Link
          to="/"
          className="flex h-11 items-center gap-2 font-bold"
          aria-label="CognitiveDAG, inicio"
        >
          <Logo />
          CognitiveDAG
        </Link>
      </header>
      <main id="contenido" className="px-4">
        <RouteError {...props} />
      </main>
    </div>
  );
}
