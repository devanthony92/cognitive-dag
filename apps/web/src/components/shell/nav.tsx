import { Link } from '@tanstack/react-router';
import { Activity, ClipboardCheck, Plug, Users, Workflow } from 'lucide-react';
import type { ComponentType, ReactNode, SVGProps } from 'react';
import type { Role } from '@cognitive-dag/contracts';
import { cn } from '../../lib/utils';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

export type DestinationKey = 'workflows' | 'runs' | 'approvals' | 'connections' | 'members';

export interface Destination {
  key: DestinationKey;
  label: string;
  to:
    | '/orgs/$organizationId/workflows'
    | '/orgs/$organizationId/runs'
    | '/orgs/$organizationId/approvals'
    | '/orgs/$organizationId/connections'
    | '/orgs/$organizationId/members';
  icon: Icon;
  /** A viewer cannot decide approvals or manage connections, so those are not offered to them. */
  hiddenFor: readonly Role[];
}

/** The five destinations, in the order of the contract (design-contract.md §5). */
export const DESTINATIONS: readonly Destination[] = [
  {
    key: 'workflows',
    label: 'Workflows',
    to: '/orgs/$organizationId/workflows',
    icon: Workflow,
    hiddenFor: [],
  },
  {
    key: 'runs',
    label: 'Ejecuciones',
    to: '/orgs/$organizationId/runs',
    icon: Activity,
    hiddenFor: [],
  },
  {
    key: 'approvals',
    label: 'Aprobaciones',
    to: '/orgs/$organizationId/approvals',
    icon: ClipboardCheck,
    hiddenFor: ['viewer'],
  },
  {
    key: 'connections',
    label: 'Conexiones',
    to: '/orgs/$organizationId/connections',
    icon: Plug,
    hiddenFor: ['viewer'],
  },
  {
    key: 'members',
    label: 'Miembros',
    to: '/orgs/$organizationId/members',
    icon: Users,
    hiddenFor: [],
  },
];

export function destinationsFor(role: Role): Destination[] {
  return DESTINATIONS.filter((destination) => !destination.hiddenFor.includes(role));
}

export type NavLayout = 'rail' | 'bottom';

interface NavItemProps {
  destination: Destination;
  organizationId: string;
  layout: NavLayout;
  /** Count or similar, shown over the glyph. */
  badge?: ReactNode;
  ariaLabel?: string;
}

/**
 * One destination of the rail or the bottom bar. The active one is not told by colour alone: it gets
 * a raised tone, a bold label and a filled glyph, and the router marks it with `aria-current`.
 */
export function NavItem({ destination, organizationId, layout, badge, ariaLabel }: NavItemProps) {
  const Glyph = destination.icon;
  return (
    <Link
      to={destination.to}
      params={{ organizationId }}
      aria-label={ariaLabel}
      className={cn(
        'relative flex min-h-11 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-raised hover:text-ink data-[status=active]:bg-raised data-[status=active]:font-bold data-[status=active]:text-ink',
        layout === 'rail'
          ? 'flex-col gap-1 px-0 py-2 text-label tracking-tight lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:py-2 lg:text-body lg:tracking-normal'
          : 'min-h-14 flex-1 flex-col gap-0.5 px-0.5 text-label',
      )}
    >
      {({ isActive }) => (
        <>
          <span className="relative">
            <Glyph
              aria-hidden
              className="size-5"
              data-filled={isActive ? 'true' : 'false'}
              fill={isActive ? 'currentColor' : 'none'}
            />
            {badge}
          </span>
          <span className="min-w-0 truncate">{destination.label}</span>
        </>
      )}
    </Link>
  );
}
