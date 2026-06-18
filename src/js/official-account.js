// The "official" spotcode-sns account — a shared identity (handle
// @spotcode_official) that admins and operators post AS. Server-side
// is_official flag on the profile (Stage 23) gates which row counts;
// here we just cache its `{ id, handle, name, avatar }` so the
// Composer's "Post as official" toggle knows what to swap in.
//
// The lookup is fire-and-forget on boot — failures cache `null` for
// a short window so we don't hammer the API while the schema isn't
// migrated yet (Stage 23 not run → the column doesn't exist).

import { getClient } from './supa.js';

const NEGATIVE_TTL_MS = 10 * 60 * 1000;   // 10 min — re-probe after a fail
const POSITIVE_TTL_MS = 6  * 60 * 60 * 1000; // 6 h — official identity is stable

let cached = null;          // { ts, value: { id, handle, name, avatar_url } | null }

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
      .select('id, handle, name, avatar_url')
      .eq('is_official', true)
      .limit(1)
      .maybeSingle();
    if (error) {
      // Most likely "column is_official does not exist" — Stage 23
      // hasn't been applied yet. Treat as "no official account".
      return null;
    }
    return data || null;
  } catch {
    return null;
  }
}

// Returns the cached value (or null) synchronously — UI uses this
// to decide whether to show the toggle without blocking on a fetch.
export function cachedOfficialAccount() {
  return cached && cached.value ? cached.value : null;
}

// Async accessor that returns the cached value when fresh, otherwise
// re-probes. Safe to call from any boot path; multiple concurrent
// calls share the same in-flight promise.
let inflight = null;
export async function getOfficialAccount() {
  if (fresh(cached)) return cached.value;
  if (inflight) return inflight;
  inflight = loadOfficial()
    .then((value) => { cached = { ts: Date.now(), value }; return value; })
    .finally(() => { inflight = null; });
  return inflight;
}

// Manual cache buster — useful after the migration is freshly
// applied or after an operator was added.
export function invalidateOfficialAccount() {
  cached = null;
  inflight = null;
}
