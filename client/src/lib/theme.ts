// Dark (default) / light theme, persisted per browser.
export type Theme = 'dark' | 'light';
const KEY = 'sa_theme';

export function getTheme(): Theme {
  try { return (localStorage.getItem(KEY) as Theme) || 'dark'; } catch { return 'dark'; }
}

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  root.classList.toggle('light', t === 'light');
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
}
