// Privacy mode — admin / operator-only toggle that swaps every OTHER
// user's display name + handle with a non-identifying placeholder
// (`User a3f8` / `@user_a3f8`). The hash is derived from the original
// handle so the same person consistently gets the same placeholder
// across the session, but no real handle / name is visible.
//
// Use case: the @spotcode_dev QA account often needs to capture
// screenshots / screen recordings of the app. Without this mode the
// captures would expose real users' handles and display names.
//
// Own identity is NEVER masked — the operator needs to recognize
// themselves in headers, the composer, the sidebar, etc. so they can
// tell what action they're performing.
//
// The toggle persists in localStorage. The flag is admin/operator-
// gated at READ time so a regular user inheriting the flag (e.g. by
// signing in on the same device) doesn't accidentally activate the
// mode against a non-dev session.

import { currentUser } from './auth.js';
import { isOperator } from './dev-mode.js';

const STORAGE_KEY = 'spotcode:privacy-mode';

// Handles allowed to use privacy mode in addition to admin/operator.
// `spotcode_dev` is the in-house QA account whose whole reason for
// existing is screen captures — they need the toggle even though
// they aren't on the ADMIN_HANDLES / OPERATOR_HANDLES lists.
const PRIVACY_MODE_HANDLES = new Set(['spotcode_dev']);

export function canUsePrivacyMode() {
  if (isOperator()) return true;
  const me = currentUser();
  return !!(me && me.handle && PRIVACY_MODE_HANDLES.has(me.handle));
}

let listeners = [];

function readFlag() {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; }
  catch { return false; }
}

export function isPrivacyMode() {
  if (!canUsePrivacyMode()) return false;
  return readFlag();
}

export function setPrivacyMode(on) {
  if (!canUsePrivacyMode()) return false;
  try {
    if (on) localStorage.setItem(STORAGE_KEY, '1');
    else    localStorage.removeItem(STORAGE_KEY);
  } catch {}
  const now = isPrivacyMode();
  listeners.forEach((fn) => { try { fn(now); } catch {} });
  return now;
}

export function onPrivacyModeChange(fn) { listeners.push(fn); }

// FNV-1a 32-bit → 4-char hex. Tiny, deterministic, no allocations.
// Same input always yields the same output so "@bob" stays
// "@user_a3f8" for the whole screenshot session — viewers can still
// see "the same person liked, then commented" patterns without
// learning the real handle.
function shortHash(s) {
  let h = 0x811c9dc5;
  const str = String(s || '').toLowerCase();
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0').slice(-4);
}

function isOwnHandle(handle) {
  const me = currentUser();
  return !!(me && handle && me.handle === handle);
}

// Return the visible @handle for `handle`. Own handle and the empty
// case pass through unchanged so the masking never wipes out the
// composer chip, the side-bar account card, etc.
export function maskHandle(handle) {
  if (!handle) return handle;
  if (!isPrivacyMode()) return handle;
  if (isOwnHandle(handle)) return handle;
  return 'user_' + shortHash(handle);
}

// Return the visible display name. Pairs with maskHandle so name +
// handle stay consistent ("User a3f8" / "@user_a3f8") — same hash,
// different prefix. Pass the underlying handle so the hash is stable
// regardless of how the display name changes.
export function maskName(handle, name) {
  if (!isPrivacyMode()) return name;
  if (isOwnHandle(handle)) return name;
  if (!handle) return name;
  return 'User ' + shortHash(handle);
}

// Convenience for the avatar-initial code path. The initial we show
// in the placeholder circle would otherwise leak the first letter of
// the real name; collapse it to "U" while masking is active.
export function maskInitial(handle, initial) {
  if (!isPrivacyMode()) return initial;
  if (isOwnHandle(handle)) return initial;
  return 'U';
}

// Replace every "@<knownHandle>" in `body` with the masked form. The
// regex is anchored on the same word boundaries notif-poller's
// mention detector uses, so e.g. "@bob" gets rewritten but
// "email@bob.example" doesn't. Used by post.js when rendering body
// text so an embedded mention doesn't leak through.
const MENTION_RE = /(^|[^A-Za-z0-9_@-])@([A-Za-z0-9_][A-Za-z0-9_-]*)/g;
export function maskMentionsInText(text) {
  if (!isPrivacyMode()) return text;
  if (!text) return text;
  return String(text).replace(MENTION_RE, (_, lead, handle) => {
    return lead + '@' + maskHandle(handle);
  });
}
