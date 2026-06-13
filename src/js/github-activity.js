// Fetch the last-12-months GitHub contribution heatmap for a handle via
// a public 3rd-party endpoint (GitHub's own contributions calendar is
// only served as HTML on github.com and is CORS-blocked from the
// browser, so we proxy through jogruber's API).
//
// Returns the data in the same { 'YYYY-MM-DD': count } shape that
// renderGrass() already consumes, so call sites stay tiny.

const ENDPOINT = 'https://github-contributions-api.jogruber.de/v4/';
const cache = new Map();   // handle -> { ts, counts }
const TTL_MS = 60 * 60 * 1000;   // 1 hour is plenty for a daily-resolution graph

export async function fetchContributions(handle) {
  if (!handle) return null;
  const cached = cache.get(handle);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.counts;
  let res;
  try { res = await fetch(ENDPOINT + encodeURIComponent(handle) + '?y=last'); }
  catch { return null; }
  if (!res.ok) return null;
  let data;
  try { data = await res.json(); } catch { return null; }
  if (!data || !Array.isArray(data.contributions)) return null;
  const counts = {};
  for (const c of data.contributions) {
    if (c && c.date) counts[c.date] = c.count || 0;
  }
  cache.set(handle, { ts: Date.now(), counts });
  return counts;
}

// Synchronous accessor for cached data — useful for the right rail which
// renders before the fetch finishes (returns null, falls back to a
// "loading" / placeholder graph; a subsequent re-render picks up the
// hydrated value).
export function cachedContributions(handle) {
  return handle ? (cache.get(handle)?.counts || null) : null;
}
