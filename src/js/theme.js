import { COLOR_THEMES, COLOR_THEME_LABELS } from './color-themes.js';
export { COLOR_THEMES, COLOR_THEME_LABELS };
const KEY = 'spotcode-theme';
const COLOR_KEY = 'spotcode-color-theme';
let colorTheme = 'standard';
export function colorThemePreference() { return colorTheme; }
export function applyColorTheme(name) {
  if (name !== 'standard' && !Object.hasOwn(COLOR_THEMES, name)) return;
  colorTheme = name;
  try { localStorage.setItem(COLOR_KEY, name); } catch {}
  renderTheme(selectedTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
}
let selectedTheme = null;
let systemTheme;
export function themePreference() { return selectedTheme || 'system'; }
function renderTheme(theme) {
  const palette = COLOR_THEMES[colorTheme]?.[theme];
  document.documentElement.dataset.colorTheme = colorTheme;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', palette?.bg || (theme === 'dark' ? '#121212' : '#fafafa'));
  const selector = document.getElementById('settings-theme');
  if (selector) { selector.value = themePreference(); selector.disabled = false; }
  const colors = document.getElementById('settings-color-theme');
  if (colors) colors.value = colorTheme;
}
export function applyTheme(theme) {
  if (!['system', 'light', 'dark'].includes(theme)) return;
  selectedTheme = theme === 'system' ? null : theme;
  renderTheme(selectedTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  try {
    if (selectedTheme) localStorage.setItem(KEY, selectedTheme);
    else localStorage.removeItem(KEY);
  } catch {}
}
export function initThemeToggle(buttonEl) {
  const savedColor = (() => { try { return localStorage.getItem(COLOR_KEY); } catch { return null; } })();
  colorTheme = Object.hasOwn(COLOR_THEMES, savedColor) ? savedColor : 'standard';
  if (savedColor && savedColor !== colorTheme) {
    try { localStorage.setItem(COLOR_KEY, colorTheme); } catch {}
  }
  const saved = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
  selectedTheme = ['light', 'dark'].includes(saved) ? saved : null;
  if (!systemTheme) {
    systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
    systemTheme.addEventListener('change', (event) => {
      if (!selectedTheme) renderTheme(event.matches ? 'dark' : 'light');
    });
  }
  renderTheme(selectedTheme || (systemTheme.matches ? 'dark' : 'light'));
  buttonEl?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  });
}
