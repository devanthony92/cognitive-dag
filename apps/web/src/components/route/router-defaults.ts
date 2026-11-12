import { RouteError } from './RouteError';
import { RouteNotFound } from './RouteNotFound';
import { RoutePending } from './RoutePending';

/**
 * What every route inherits: its own error and not-found panels, the 150 ms skeleton, and the preload
 * of a route's code when its link is hovered or focused. Shared by `main.tsx` and the tests so both run
 * the same router configuration (F10, research R5).
 */
export const routerDefaults = {
  defaultErrorComponent: RouteError,
  defaultNotFoundComponent: RouteNotFound,
  defaultPendingComponent: RoutePending,
  defaultPendingMs: 150,
  defaultPendingMinMs: 300,
  defaultPreload: 'intent',
} as const;
