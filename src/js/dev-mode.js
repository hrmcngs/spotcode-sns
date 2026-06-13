// Developer-mode toggle. Stored in localStorage and gated to a single
// allowlist of GitHub-style handles. Regular users never see the toggle
// and the dev-only UI never renders for them.

import { currentUser } from './auth.js';

const KEY = 'spotcode:dev-mode';
const ALLOWED_HANDLES = new Set(['hrmcngs']);

let listeners = [];

export function canBeDev() {
  const me = currentUser();
  return !!(me && me.handle && ALLOWED_HANDLES.has(me.handle));
}

export function isDevMode() {
  if (!canBeDev()) return false;
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function setDevMode(on) {
  if (!canBeDev()) return false;
  try {
    if (on) localStorage.setItem(KEY, '1');
    else    localStorage.removeItem(KEY);
  } catch {}
  listeners.forEach(fn => { try { fn(isDevMode()); } catch {} });
  // Update the <html> data-attribute so CSS can scope dev-only chrome.
  document.documentElement.dataset.dev = isDevMode() ? '1' : '';
  return true;
}

export function onDevModeChange(fn) { listeners.push(fn); }

// Apply the data-attr once on boot so reloads keep the styled state.
export function initDevMode() {
  document.documentElement.dataset.dev = isDevMode() ? '1' : '';
}
