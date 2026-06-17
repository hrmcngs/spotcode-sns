// Multi-account switcher backing store.
//
// Keeps a localStorage list of accounts the user has signed into on this
// device, each carrying the refresh token Supabase needs to re-mint a
// session. The active account is whichever the Supabase client itself
// is currently holding — this store is the "saved" set that lets the
// user flip between accounts without re-typing their password.
//
// Refresh tokens are sensitive: they grant full session access until
// they expire or are revoked server-side. We store them in localStorage
// alongside the supabase-js default session, so the exposure surface is
// the same one Supabase already uses. Don't log them.

import { read, write } from './storage.js';

const KEY = 'spotcode:saved-accounts';
// Set by switchAccount() before it triggers a reload; consumed by
// initAuth() on the next page load so the actual session swap
// happens on a fresh runtime instead of fighting supabase-js's
// in-page state machine (auto-refresh timers, in-flight requests,
// stale onAuthStateChange subscribers).
const PENDING_KEY = 'spotcode:pending-account-switch';

function load() {
  const list = read(KEY, []);
  return Array.isArray(list) ? list : [];
}

function save(list) { write(KEY, list); }

// Public view of a saved account row — strips the refresh token before
// handing it to UI code so a stray console.log can't leak it.
function publicView(row) {
  if (!row) return null;
  return {
    id:          row.id,
    email:       row.email || '',
    handle:      row.handle || '',
    name:        row.name || row.handle || 'User',
    avatarUrl:   row.avatarUrl || null,
    avatarShape: row.avatarShape || 'round',
    lastUsed:    row.lastUsed || 0,
  };
}

export function listSavedAccounts() {
  return load().map(publicView).sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
}

export function hasSavedAccount(id) {
  return !!load().find(r => r.id === id);
}

// Internal — used by switchAccount in auth.js. Not exported via the
// public list view so the refresh token doesn't leak into UI code.
export function getRefreshToken(id) {
  const row = load().find(r => r.id === id);
  return row ? row.refreshToken : null;
}

// Insert-or-update. Called whenever we know the active session is
// associated with a user — login, register, post-switch refresh.
export function rememberAccount({ user, session }) {
  if (!user || !session?.refresh_token) return;
  const list = load();
  const i = list.findIndex(r => r.id === user.id);
  const row = {
    id:           user.id,
    email:        user.email || '',
    handle:       user.handle || '',
    name:         user.name || user.handle || 'User',
    avatarUrl:    user.avatarImage || null,
    avatarShape:  user.avatarShape || 'round',
    refreshToken: session.refresh_token,
    lastUsed:     Date.now(),
  };
  if (i >= 0) list[i] = row;
  else list.push(row);
  save(list);
}

export function forgetAccount(id) {
  const list = load().filter(r => r.id !== id);
  save(list);
}

// Mark `id` as the account the user wants to switch to on the next
// page load. The caller is expected to follow this with a reload.
export function setPendingSwitch(id) {
  if (id) try { localStorage.setItem(PENDING_KEY, String(id)); } catch {}
}

// Read-and-clear: called once at boot by initAuth so a stale flag
// can't trigger an unexpected switch on a subsequent reload.
export function consumePendingSwitch() {
  let v = null;
  try { v = localStorage.getItem(PENDING_KEY); } catch {}
  try { localStorage.removeItem(PENDING_KEY); } catch {}
  return v || null;
}
