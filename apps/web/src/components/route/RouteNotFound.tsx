import { Link } from '@tanstack/react-router';
import { buttonVariants } from '../ui/button';
import { ErrorPanel } from './RouteError';

/** `defaultNotFoundComponent`: an address that does not exist, with the way back, inside the shell. */
export function RouteNotFound() {
  return (
    <ErrorPanel
      title="No encontramos esa página"
      actions={
        <Link to="/" className={buttonVariants()}>
          Volver
        </Link>
      }
    >
      <p>La dirección no existe o cambió de lugar. Vuelve al inicio para seguir.</p>
    </ErrorPanel>
  );
}
