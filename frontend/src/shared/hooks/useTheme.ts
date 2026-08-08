import { useCallback, useEffect, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'bizpilot-ai:theme';
const listeners = new Set<() => void>();
let currentTheme: Theme = readStoredTheme();

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}

function getSystemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveIsDark(theme: Theme): boolean {
  return theme === 'dark' || (theme === 'system' && getSystemPrefersDark());
}

function applyThemeToDocument(theme: Theme): void {
  const root = window.document.documentElement;
  root.classList.toggle('dark', resolveIsDark(theme));
  root.style.colorScheme = resolveIsDark(theme) ? 'dark' : 'light';
}

function setTheme(theme: Theme): void {
  currentTheme = theme;
  window.localStorage.setItem(STORAGE_KEY, theme);
  applyThemeToDocument(theme);
  listeners.forEach((listener) => {
    listener();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Theme {
  return currentTheme;
}

function getServerSnapshot(): Theme {
  return 'system';
}

/**
 * Reads/writes the active color theme (`light` | `dark` | `system`), persists
 * it to `localStorage`, and keeps the `dark` class on `<html>` in sync.
 * Call `applyInitialTheme()` once, synchronously, before React hydrates
 * (e.g. in an inline script in `index.html`) to avoid a flash of the wrong theme.
 */
export function useTheme(): {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
} {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (): void => {
      applyThemeToDocument('system');
    };
    media.addEventListener('change', handleChange);
    return () => {
      media.removeEventListener('change', handleChange);
    };
  }, [theme]);

  return {
    theme,
    resolvedTheme: resolveIsDark(theme) ? 'dark' : 'light',
    setTheme: useCallback(setTheme, []),
  };
}

/**
 * Applies the persisted theme synchronously. Intended for a blocking inline
 * script in `index.html` so the correct theme is set before first paint.
 */
export function applyInitialTheme(): void {
  applyThemeToDocument(readStoredTheme());
}
