import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import html from '../index.html?raw';
import source from '../public/theme-init.js?raw';
import {
  THEME_STORAGE_KEY,
  applyTheme,
  readPreference,
  setPreference,
  watchSystemTheme,
} from '../src/lib/theme';

const root = document.documentElement;

type Listener = (event: { matches: boolean }) => void;

function stubMatchMedia(initialDark: boolean) {
  const listeners = new Set<Listener>();
  const query = {
    matches: initialDark,
    addEventListener: (_: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => query),
  );
  return {
    emit(matches: boolean) {
      query.matches = matches;
      for (const listener of listeners) listener({ matches });
    },
    listeners,
  };
}

describe('theme preference', () => {
  beforeEach(() => {
    localStorage.clear();
    root.removeAttribute('data-theme');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('defaults to the system preference', () => {
    expect(readPreference()).toBe('system');
  });

  it('sets data-theme only for light or dark and removes it for system', () => {
    applyTheme('light');
    expect(root.getAttribute('data-theme')).toBe('light');
    applyTheme('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
    applyTheme('system');
    expect(root.hasAttribute('data-theme')).toBe(false);
  });

  it('stores the choice and reads it back', () => {
    setPreference('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(readPreference()).toBe('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
    setPreference('system');
    expect(readPreference()).toBe('system');
    expect(root.hasAttribute('data-theme')).toBe(false);
  });

  it('ignores a stored value that is not a known preference', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    expect(readPreference()).toBe('system');
  });

  it('listens to prefers-color-scheme and stops when unsubscribed', () => {
    const media = stubMatchMedia(false);
    const seen: string[] = [];
    const stop = watchSystemTheme((scheme) => seen.push(scheme));
    media.emit(true);
    media.emit(false);
    expect(seen).toEqual(['dark', 'light']);
    stop();
    expect(media.listeners.size).toBe(0);
  });

  it('degrades to system, without throwing, when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readPreference()).toBe('system');
    expect(() => setPreference('light')).not.toThrow();
    // The choice still applies to this page even though it cannot be remembered.
    expect(root.getAttribute('data-theme')).toBe('light');
  });
});

describe('public/theme-init.js (runs before the first render)', () => {
  // The script runs as the browser runs it: as a <script> element of the document.
  const run = () => {
    const script = document.createElement('script');
    script.textContent = source;
    document.head.append(script);
    script.remove();
  };

  beforeEach(() => {
    localStorage.clear();
    root.removeAttribute('data-theme');
  });
  afterEach(() => vi.restoreAllMocks());

  it('applies a stored light or dark choice', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    run();
    expect(root.getAttribute('data-theme')).toBe('light');
  });

  it('leaves the document alone for system, unknown values and blocked storage', () => {
    run();
    expect(root.hasAttribute('data-theme')).toBe(false);
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    run();
    expect(root.hasAttribute('data-theme')).toBe(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(run).not.toThrow();
    expect(root.hasAttribute('data-theme')).toBe(false);
  });

  it('is an external file, not an inline script, so script-src self holds', () => {
    expect(html).toMatch(/<script src="\/theme-init\.js"><\/script>/);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(html).not.toMatch(/<style|style=/);
  });
});
