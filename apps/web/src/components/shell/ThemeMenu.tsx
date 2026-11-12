import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { THEME_OPTIONS, useThemePreference, watchSystemTheme } from '../../lib/theme';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

/** The scheme the system asks for right now, kept up to date while the page is open. */
function useSystemScheme(): 'light' | 'dark' {
  const [scheme, setScheme] = useState<'light' | 'dark'>(() =>
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light',
  );
  useEffect(() => watchSystemTheme(setScheme), []);
  return scheme;
}

const SCHEME_LABEL = { light: 'claro', dark: 'oscuro' } as const;

/** The three theme options as menu radio items. Used inside the user menu and on its own. */
export function ThemeRadioGroup() {
  const [preference, setPreference] = useThemePreference();
  const system = useSystemScheme();
  return (
    <>
      <DropdownMenuLabel>Tema</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={preference}
        onValueChange={(value) => {
          const option = THEME_OPTIONS.find((item) => item.value === value);
          if (option) setPreference(option.value);
        }}
      >
        {THEME_OPTIONS.map((option) => (
          <DropdownMenuRadioItem key={option.value} value={option.value}>
            <span className="flex-1">{option.label}</span>
            {option.value === 'system' && (
              <span className="text-body-sm text-ink-muted">({SCHEME_LABEL[system]})</span>
            )}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
}

/** Stand-alone theme button for the header when nobody is signed in. */
export function ThemeMenu() {
  const [preference] = useThemePreference();
  const system = useSystemScheme();
  const shown = preference === 'system' ? system : preference;
  const Glyph = preference === 'system' ? Monitor : shown === 'dark' ? Moon : Sun;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Tema de color">
          <Glyph aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <ThemeRadioGroup />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
