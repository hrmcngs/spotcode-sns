const KEY = 'spotcode-theme';
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(KEY, theme); } catch {}
}
export function initThemeToggle(buttonEl) {
  const saved = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
  applyTheme(saved || 'dark');
  buttonEl?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  });
}
