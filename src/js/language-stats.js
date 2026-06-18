// Per-user GitHub language stats — direct port of the logic in
// hrmcngs/github-stats-charts (server-side Node script). Same idea:
// gather the user's repos (own + public-member orgs + inferred from
// PushEvents), hit `/repos/{full_name}/languages` for each, sum the
// per-language byte counts, then render a horizontal bar with the
// top N languages plus an "Other" bucket.
//
// Why this is lighter than the old skill-badges code that lived in
// `badges.js`: the languages endpoint returns aggregated bytes for
// the entire repo in one call. The old approach pulled the full
// recursive git tree per repo (often 2-3 sub-calls each just to
// guess the default branch) and counted file extensions client-side.
// Same 60/h unauth limit, but ~3-5× fewer requests per profile.
//
// Same defensive layering as the previous badges module:
//   • cache results in localStorage (24h for hits, 10min for empties)
//   • module-level RATE_LIMIT cooldown — short-circuit to whatever's
//     cached when GitHub starts returning 403
//   • AbortController timeout on every fetch so a hung request can't
//     lock the whole resolution
//
// Public API:
//   getLanguageStats(handle) → Promise<{ langs: [[name, bytes], …], total }>
//   cachedLanguageStats(handle) → cached value or null (sync)
//   isRateLimited() → bool
//   langColor(name) → '#hex' for a known language, or grey

import { read, write } from './storage.js';

const CACHE_KEY        = 'spotcode:lang-stats:v1';
const TTL_MS           = 24 * 60 * 60 * 1000;
const EMPTY_TTL_MS     = 10 * 60 * 1000;
const MAX_REPOS_TO_SCAN = 30;
const MAX_ORGS_TO_SCAN  = 3;
const MAX_REPOS_PER_ORG = 10;

let rateLimitedUntil = 0;
const RATE_LIMIT_COOLDOWN_MS = 60 * 60 * 1000;

// GitHub Linguist colour palette — same table as
// github-stats-charts/src/js/charts.js so the SVG colours match the
// reference site.
const LANG_COLORS = {
  JavaScript: '#f1e05a', TypeScript: '#3178c6', HTML: '#e34c26', CSS: '#563d7c',
  Java: '#b07219', Python: '#3572A5', C: '#555555', 'C++': '#f34b7d', 'C#': '#178600',
  Shell: '#89e051', Ruby: '#701516', Go: '#00ADD8', Rust: '#dea584', PHP: '#4F5D95',
  Kotlin: '#A97BFF', Swift: '#F05138', Dart: '#00B4AB', Vue: '#41b883', Lua: '#000080',
  GLSL: '#5686a5', Batchfile: '#C1F12E', Makefile: '#427819', Dockerfile: '#384d54',
  'Jupyter Notebook': '#DA5B0B', SCSS: '#c6538c', MDX: '#fcb32c', Markdown: '#083fa1',
  mcfunction: '#E22837', 'Common Lisp': '#3fb68b', NewLisp: '#87AED7', Lisp: '#3fb68b',
  YAML: '#cb171e', JSON: '#292929', TOML: '#9c4221',
};
export function langColor(name) {
  return LANG_COLORS[name] || '#8b949e';
}

function readCache()  { return read(CACHE_KEY, {}); }
function writeCache(o){ write(CACHE_KEY, o); }
function cacheFor(handle) {
  const all = readCache();
  const entry = all[handle];
  if (!entry) return null;
  const ttl = (entry.langs && entry.langs.length === 0) ? EMPTY_TTL_MS : TTL_MS;
  if (Date.now() - entry.ts > ttl) return null;
  return entry.value;
}
function storeCache(handle, value) {
  const all = readCache();
  all[handle] = { ts: Date.now(), value, langs: value && value.langs };
  writeCache(all);
}

export function cachedLanguageStats(handle) {
  if (!handle) return null;
  return cacheFor(handle);
}
export function isRateLimited() {
  return Date.now() < rateLimitedUntil;
}

async function fetchJson(url, timeoutMs = 10000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { 'Accept': 'application/vnd.github+json' },
      signal: ctl.signal,
    });
    if (r.status === 403) {
      rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
      throw new Error('RATE_LIMIT');
    }
    if (!r.ok) throw new Error('HTTP_' + r.status);
    if (rateLimitedUntil) rateLimitedUntil = 0;
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

// Gather a deduped list of repo full_names to scan. Mirrors the
// previous badges.js strategy: events feed (recently pushed) +
// owned non-forks + public-member orgs + inferred-from-events orgs.
async function gatherRepos(handle) {
  const out = new Map();   // full_name → {fullName}
  const orgCandidates = new Set();

  // 1. Owned non-fork repos, sorted by recent push.
  try {
    const list = await fetchJson(
      'https://api.github.com/users/' + encodeURIComponent(handle) +
      '/repos?per_page=' + MAX_REPOS_TO_SCAN + '&sort=pushed&type=owner'
    );
    for (const r of (list || [])) {
      if (r.fork) continue;
      if (r.full_name && !out.has(r.full_name)) out.set(r.full_name, { fullName: r.full_name });
    }
  } catch {}

  // 2. Recent push events — captures repos the user contributes to.
  try {
    const events = await fetchJson(
      'https://api.github.com/users/' + encodeURIComponent(handle) + '/events/public?per_page=100'
    );
    for (const ev of (events || [])) {
      if (ev.type !== 'PushEvent' || !ev.repo?.name) continue;
      const name = ev.repo.name;
      const slash = name.indexOf('/');
      if (slash < 1) continue;
      const owner = name.slice(0, slash);
      if (!out.has(name)) out.set(name, { fullName: name });
      if (owner.toLowerCase() !== handle.toLowerCase()) orgCandidates.add(owner);
    }
  } catch {}

  // 3. Public org memberships.
  try {
    const orgs = await fetchJson(
      'https://api.github.com/users/' + encodeURIComponent(handle) + '/orgs?per_page=' + MAX_ORGS_TO_SCAN
    );
    for (const o of (orgs || [])) if (o && o.login) orgCandidates.add(o.login);
  } catch {}

  // 4. Top public repos from each candidate org (404 if it's a user,
  //    skip in that case).
  const orgs = Array.from(orgCandidates).slice(0, MAX_ORGS_TO_SCAN);
  for (const org of orgs) {
    try {
      const list = await fetchJson(
        'https://api.github.com/orgs/' + encodeURIComponent(org) +
        '/repos?per_page=' + MAX_REPOS_PER_ORG + '&sort=pushed&type=public'
      );
      for (const r of (list || [])) {
        if (r.fork) continue;
        if (r.full_name && !out.has(r.full_name)) out.set(r.full_name, { fullName: r.full_name });
      }
    } catch {}
  }

  return Array.from(out.values()).slice(0, MAX_REPOS_TO_SCAN);
}

// Public entry. Returns { langs: [['TypeScript', 12345], …], total }.
export async function getLanguageStats(handle) {
  if (!handle) return { langs: [], total: 0 };
  const cached = cacheFor(handle);
  if (cached) return cached;
  if (Date.now() < rateLimitedUntil) return cached || { langs: [], total: 0 };

  // Skip org accounts — the personal language stats only make sense
  // for individual users. type=Organization comes back from /users/X.
  let meta;
  try { meta = await fetchJson('https://api.github.com/users/' + encodeURIComponent(handle)); }
  catch { meta = null; }
  if (meta?.type === 'Organization') {
    const empty = { langs: [], total: 0 };
    storeCache(handle, empty);
    return empty;
  }
  if (Date.now() < rateLimitedUntil) return { langs: [], total: 0 };

  const repos = await gatherRepos(handle);

  // Per-repo /languages calls in parallel (the same set GitHub
  // computes for the repo's own language bar).
  const langBytes = Object.create(null);
  await Promise.all(repos.map(async (r) => {
    let langs;
    try {
      langs = await fetchJson('https://api.github.com/repos/' + r.fullName + '/languages');
    } catch { return; }
    for (const [name, bytes] of Object.entries(langs || {})) {
      langBytes[name] = (langBytes[name] || 0) + (Number(bytes) || 0);
    }
  }));

  const sorted = Object.entries(langBytes).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((a, [, b]) => a + b, 0);
  const value = { langs: sorted, total };

  // Don't poison the cache with an empty result that came from a
  // mid-flight rate-limit; let the next visit retry instead.
  if (!sorted.length && Date.now() < rateLimitedUntil) return value;
  storeCache(handle, value);
  return value;
}
