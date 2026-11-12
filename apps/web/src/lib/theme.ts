import { useSyncExternalStore } from 'react';

/** What the person chose: follow the system, or force light or dark. */
export type ThemePreference = 'system' | 'light' | 'dark';

/** Must match `public/theme-init.js`, which applies it before the first paint. */
export const THEME_STORAGE_KEY = 'cdag-theme';

export const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'Sistema' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
];

function isPreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** The stored choice; `system` when nothing is stored, the value is unknown or storage is blocked. */
export function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

/** Puts `data-theme` on <html> for light and dark, and removes it for system. */
export function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);
}

const listeners = new Set<() => void>();
let current: ThemePreference | null = null;

/** Applies and remembers a choice. If storage is blocked the choice still holds for this page. */
export function setPreference(preference: ThemePreference): void {
  current = preference;
  try {
    if (preference === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Not remembered; the document is still updated below.
  }
  applyTheme(preference);
  for (const listener of listeners) listener();
}

/** Calls back when the system switches between light and dark. Returns the unsubscribe function. */
export function watchSystemTheme(callback: (scheme: 'light' | 'dark') => void): () => void {
  if (typeof matchMedia !== 'function') return () => undefined;
  const query = matchMedia('(prefers-color-scheme: dark)');
  const onChange = (event: { matches: boolean }): void =>
    callback(event.matches ? 'dark' : 'light');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** Applies the stored choice once at startup (the head script already did it before the first paint). */
export function initTheme(): void {
  current = readPreference();
  applyTheme(current);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current choice for the theme menu. */
export function useThemePreference(): [ThemePreference, (preference: ThemePreference) => void] {
  const preference = useSyncExternalStore(
    subscribe,
    () => (current ??= readPreference()),
    () => 'system' as const,
  );
  return [preference, setPreference];
}
