import type { ThemeMode } from '../state/filters';

export function initialTheme(): ThemeMode {
  try {
    const s = localStorage.getItem('cm-theme');
    if (s === 'dark' || s === 'light' || s === 'system') return s;
  } catch { /* ignore */ }
  return 'dark';
}

export function resolveTheme(t: ThemeMode): 'dark' | 'light' {
  if (t !== 'system') return t;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
