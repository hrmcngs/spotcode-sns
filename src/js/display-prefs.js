// User-facing display toggles that affect rendering globally via
// data-attributes on <html>. Stored in localStorage so the choice
// survives reloads / new tabs.
//
// Currently exposes a single toggle: whether decorative badges
// (the {} Programmer pill, the 「組織」 chip on profile names, the
// 「アイデア」 / WIP post-kind chip, the visibility hint, etc.)
// render or get CSS-hidden. The defaults are visible-everything;
// flipping the toggle off in /settings → 表示 applies
// `data-hide-badges="1"` on <html> and the matching CSS rules
// suppress every badge selector at once.

const KEY = 'spotcode:hide-badges';

export function badgesHidden() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function setBadgesHidden(hide) {
  try {
    if (hide) localStorage.setItem(KEY, '1');
    else      localStorage.removeItem(KEY);
  } catch {}
  applyDisplayPrefs();
}

// Apply every display-pref attribute on <html>. Call once on boot
// and after any setter so a fresh page load matches the click flow.
export function applyDisplayPrefs() {
  const root = document.documentElement;
  if (badgesHidden()) root.dataset.hideBadges = '1';
  else                delete root.dataset.hideBadges;
}
