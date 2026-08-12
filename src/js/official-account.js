// Lightweight lookup for the shared "official" profile (@spotcode_official).
//
// The account itself is a normal Supabase user that admin / operators
// sign up via the regular /signup UI; this module just resolves its
// handle → profile row so the account-menu can surface it as a
// switch target (or as a "log in" prompt if the viewer hasn't paired
// a session for it yet).
//
// Schema-agnostic on purpose: no is_official column required. The
// handle is the source of truth, mirroring how dev-mode.js hardcodes
// ADMIN_HANDLES / OPERATOR_HANDLES.

import { getClient } from './supa.js';

export const OFFICIAL_HANDLE = 'spotcode_official';
// (No exported OFFICIAL_EMAIL: per Stage 25 the brand account's
// password / email is irrelevant to day-to-day use — admins and
// operators "become" the official via privilege, no auth prompt.)

const POSITIVE_TTL_MS = 6  * 60 * 60 * 1000; // 6h — official identity is stable
const NEGATIVE_TTL_MS = 10 * 60 * 1000;       // 10min — re-probe after a miss

let cached = null;    // { ts, value: { id, handle, name, avatar_url, avatar_shape } | null }
let inflight = null;

function fresh(entry) {
  if (!entry) return false;
  const ttl = entry.value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
  return Date.now() - entry.ts <= ttl;
}

async function loadOfficial() {
  const supa = await getClient();
  try {
    const { data, error } = await supa
      .from('profiles')
      .select('id, handle, name, avatar_url, avatar_shape')
      .eq('handle', OFFICIAL_HANDLE)
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return data || null;
  } catch {
    return null;
  }
}

// Synchronous accessor — returns the cached value (or null) without
// blocking. The account-menu uses this so opening the menu never
// stalls on a network round-trip.
export function cachedOfficialAccount() {
  return cached && cached.value ? cached.value : null;
}

// Refresh the synchronous display identity immediately after an authorised
// profile edit instead of leaving the topbar/avatar on the six-hour cache.
export function setCachedOfficialAccount(value) {
  if (!value) return;
  cached = { ts: Date.now(), value };
}

// Async accessor — returns cached when fresh, otherwise re-probes.
// Concurrent callers share the in-flight promise.
export async function getOfficialAccount() {
  if (fresh(cached)) return cached.value;
  if (inflight) return inflight;
  inflight = loadOfficial()
    .then((value) => { cached = { ts: Date.now(), value }; return value; })
    .finally(() => { inflight = null; });
  return inflight;
}
