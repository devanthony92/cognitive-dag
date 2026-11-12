import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { DemoNotice } from '../../features/demo/DemoNotice';
import { sessionQuery } from '../../features/session/session';
import { BottomBar } from './BottomBar';
import { Header } from './Header';
import { NavRail } from './NavRail';
import { SkipLink } from './SkipLink';

export const MAIN_ID = 'contenido';

/**
 * The frame every screen lives in, also while it loads, is empty or fails: skip link, header, left
 * rail (bottom bar on a phone) and the one `main`. The rail only exists inside an organization.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const session = useQuery(sessionQuery);
  const { organizationId } = useParams({ strict: false });
  const role = session.data?.organizations.find(
    (organization) => organization.id === organizationId,
  )?.role;
  const navigation = organizationId !== undefined && role !== undefined;

  return (
    <div className="min-h-dvh bg-ground text-ink">
      <SkipLink targetId={MAIN_ID} />
      <DemoNotice />
      <Header />
      <div className="flex">
        {navigation && <NavRail organizationId={organizationId} role={role} />}
        <main
          id={MAIN_ID}
          tabIndex={-1}
          className={
            navigation
              ? 'min-w-0 flex-1 pb-[calc(var(--bottom-bar-height)+env(safe-area-inset-bottom))] outline-none focus-visible:shadow-none md:pb-0'
              : 'min-w-0 flex-1 outline-none focus-visible:shadow-none'
          }
        >
          {children}
        </main>
      </div>
      {navigation && <BottomBar organizationId={organizationId} role={role} />}
    </div>
  );
}
