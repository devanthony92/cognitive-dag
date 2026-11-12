import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { KeyRound, LogOut } from 'lucide-react';
import type { SessionInfo } from '@cognitive-dag/contracts';
import { forgetSession, logout } from '../../features/session/session';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { ThemeRadioGroup } from './ThemeMenu';

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : [words[0]];
  return letters
    .map((word) => word?.[0] ?? '')
    .join('')
    .toUpperCase();
}

/** Account menu: who is signed in, password, theme and sign-out. */
export function UserMenu({ user }: { user: SessionInfo['user'] }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const signOut = useMutation({
    mutationFn: logout,
    // Even if the call fails (the session was already gone) the browser must forget it.
    onSettled: async () => {
      forgetSession(queryClient);
      await navigate({ to: '/login' });
    },
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Menú de usuario"
        className="flex h-11 min-w-11 items-center justify-center gap-2 rounded-md px-1 hover:bg-raised md:px-2"
      >
        <span
          aria-hidden
          className="flex size-8 items-center justify-center rounded-station border border-line-strong bg-raised text-body-sm font-semibold"
        >
          {initialsOf(user.name)}
        </span>
        <span className="hidden max-w-40 truncate text-body-sm lg:inline">{user.name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col">
          <span className="truncate">{user.name}</span>
          <span className="truncate text-body-sm font-normal text-ink-muted">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="min-h-11">
          <Link to="/account/password">
            <KeyRound aria-hidden className="size-4" />
            Contraseña
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <ThemeRadioGroup />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="min-h-11"
          disabled={signOut.isPending}
          onSelect={() => signOut.mutate()}
        >
          <LogOut aria-hidden className="size-4" />
          Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
