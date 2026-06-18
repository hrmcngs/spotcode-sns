// Persistent client flag: am I, as an admin or operator, currently
// "viewing as" the @spotcode_official brand account?
//
// The actual Supabase session never changes — only the displayed
// identity and the author_id we write on inserts. Stage 25 RLS
// validates the substitution server-side so a tampered client can't
// post as official without the privilege.
//
// localStorage so the mode survives reloads and account-switcher
// driven boot reloads. Module subscribers fire on each change so
// the topbar avatar + composer avatar can re-render in place.

import { cachedOfficialAccount } from './official-account.js';

const KEY = 'spotcode:posting-as-official';

let listeners = new Set();

export function isPostingAsOfficial() {
  try { return localStorage.getItem(KEY) === '1'; }
  catch { return false; }
}

export function setPostingAsOfficial(on) {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else    localStorage.removeItem(KEY);
  } catch {}
  listeners.forEach((fn) => { try { fn(!!on); } catch {} });
}

// Subscribe to mode changes (e.g. so the topbar + composer can
// re-render their avatars). Returns an unsubscribe function.
export function onPostingIdentityChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Returns the identity the UI should *display* — the real user when
// the overlay is off, or a synthesised view of the official profile
// when it's on. Falls through to the real user when the official
// cache hasn't resolved yet so we never render a half-blank topbar.
export function displayUser(realUser) {
  if (!realUser || !isPostingAsOfficial()) return realUser;
  const o = cachedOfficialAccount();
  if (!o) return realUser;
  return {
    ...realUser,
    id:           o.id,
    handle:       o.handle,
    name:         o.name,
    avatarImage:  o.avatar_url,
    avatarShape:  o.avatar_shape,
    avatar:       (o.name && o.name[0] ? o.name[0] : '?').toUpperCase(),
  };
}
