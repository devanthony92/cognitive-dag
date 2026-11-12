import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { OrganizationSwitcher } from '../../features/organizations/OrganizationSwitcher';
import { sessionQuery } from '../../features/session/session';
import { buttonVariants } from '../ui/button';
import { Logo } from './Logo';
import { ThemeMenu } from './ThemeMenu';
import { UserMenu } from './UserMenu';

/**
 * Top bar, 56 px: brand, organization switcher and user menu. Nothing in it is `nowrap`: the switcher
 * truncates its label and the brand text hides on a phone, so the bar never outgrows the window.
 */
export function Header() {
  const session = useQuery(sessionQuery);
  const navigate = useNavigate();
  const { organizationId } = useParams({ strict: false });
  const info = session.data;

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-line bg-ground px-3 sm:px-4">
      <Link
        to="/"
        className="flex h-11 shrink-0 items-center gap-2 rounded-md px-1 font-bold tracking-tight"
        aria-label="CognitiveDAG, inicio"
      >
        <Logo />
        <span className="hidden sm:inline">CognitiveDAG</span>
      </Link>
      {info && (
        <div className="min-w-0 flex-1 sm:flex-none">
          <OrganizationSwitcher
            organizations={info.organizations}
            activeId={organizationId}
            onSelect={(id) =>
              void navigate({ to: '/orgs/$organizationId', params: { organizationId: id } })
            }
          />
        </div>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {info ? (
          <UserMenu user={info.user} />
        ) : (
          <>
            <ThemeMenu />
            {session.isSuccess && (
              <Link
                to="/login"
                className={buttonVariants({ variant: 'outline', className: 'whitespace-normal' })}
              >
                Iniciar sesión
              </Link>
            )}
          </>
        )}
      </div>
    </header>
  );
}
