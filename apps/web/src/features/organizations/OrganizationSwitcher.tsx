import { ChevronsUpDown } from 'lucide-react';
import { useState } from 'react';
import type { OrganizationSummary, Role } from '@cognitive-dag/contracts';
import { Button } from '../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { CreateOrganizationDialog } from './CreateOrganizationDialog';

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
};

interface Props {
  organizations: OrganizationSummary[];
  /** The organization of the current route, if the route has one. */
  activeId: string | undefined;
  onSelect: (organizationId: string) => void;
}

/** Header control that shows the active organization and switches between the user's ones. */
export function OrganizationSwitcher({ organizations, activeId, onSelect }: Props) {
  const [creating, setCreating] = useState(false);
  const active = organizations.find((organization) => organization.id === activeId);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" aria-label="Cambiar de organización">
            {active?.name ?? 'Elegir organización'}
            <ChevronsUpDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Organizaciones</DropdownMenuLabel>
          {organizations.map((organization) => (
            <DropdownMenuItem key={organization.id} onSelect={() => onSelect(organization.id)}>
              <span className="flex-1">{organization.name}</span>
              <span className="text-xs text-muted-foreground">
                {organization.isPersonal ? 'Personal · ' : ''}
                {ROLE_LABELS[organization.role]}
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            Nueva organización…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateOrganizationDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(organization) => {
          setCreating(false);
          onSelect(organization.id);
        }}
      />
    </>
  );
}
