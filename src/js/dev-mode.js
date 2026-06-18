// Moderation-role gates.
//
// Two tiers above a regular user:
//   admin     — single immutable handle (hrmcngs). Today's "dev mode"
//               toggle in /settings is admin-only.
//   operator  — handles moderation duties: deletes other people's
//               posts, handles abuse reports, can pin a spot anywhere
//               (regular users are bounded to the device's geolocation).
//
// Both sets are hardcoded for now. A follow-up PR moves the operator
// list to a Supabase column the admin can edit from /settings so the
// role is "assignable" without a code deploy.

import { currentUser } from './auth.js';

const DEV_TOGGLE_KEY = 'spotcode:dev-mode';
const ADMIN_HANDLES    = new Set(['hrmcngs']);
const OPERATOR_HANDLES = new Set(['hrmcngs', 'aya526dev']);

let listeners = [];

// Admin tier — top of the chain. Implicit operator privileges too.
export function isAdmin() {
  const me = currentUser();
  return !!(me && me.handle && ADMIN_HANDLES.has(me.handle));
}

// Operator tier — moderation duties. Includes everyone in the admin
// set so we don't have to scatter `isAdmin() || isOperator()` checks
// at every call site.
export function isOperator() {
  if (isAdmin()) return true;
  const me = currentUser();
  return !!(me && me.handle && OPERATOR_HANDLES.has(me.handle));
}

// Legacy alias: pre-roles code path called canBeDev() to gate the
// settings "Developer" cards (Supabase override, dev toggle, etc.).
// Those panels are admin-only.
export function canBeDev() { return isAdmin(); }

// localStorage-backed convenience toggle for the admin. Operators
// don't get a separate toggle — their powers are always active.
export function isDevMode() {
  if (!isAdmin()) return false;
  try { return localStorage.getItem(DEV_TOGGLE_KEY) === '1'; } catch { return false; }
}

export function setDevMode(on) {
  if (!isAdmin()) return false;
  try {
    if (on) localStorage.setItem(DEV_TOGGLE_KEY, '1');
    else    localStorage.removeItem(DEV_TOGGLE_KEY);
  } catch {}
  listeners.forEach(fn => { try { fn(isDevMode()); } catch {} });
  document.documentElement.dataset.dev = isDevMode() ? '1' : '';
  return true;
}

export function onDevModeChange(fn) { listeners.push(fn); }

// Apply the data-attr once on boot so reloads keep the styled state.
export function initDevMode() {
  document.documentElement.dataset.dev = isDevMode() ? '1' : '';
}

// Surface for UI badges / debug. Returns 'admin' | 'operator' | 'user'.
export function currentRole() {
  if (isAdmin())    return 'admin';
  if (isOperator()) return 'operator';
  return 'user';
}
