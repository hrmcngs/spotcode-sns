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

// 1-2 letter abbreviation for the round language medal. Hand-mapped
// for the cases where the auto-from-first-letters version would lose
// information ("J" alone collides with both Java and JavaScript;
// "C" collides with C / C++ / C#).
const LANG_ABBR = {
  JavaScript: 'JS', TypeScript: 'TS', HTML: 'HT', CSS: 'CS',
  Java: 'Jv', Python: 'Py', C: 'C', 'C++': 'C+', 'C#': 'C#',
  Shell: 'Sh', Ruby: 'Rb', Go: 'Go', Rust: 'Rs', PHP: 'PH',
  Kotlin: 'Kt', Swift: 'Sw', Dart: 'Dt', Vue: 'Vu', Lua: 'Lu',
  GLSL: 'GL', Batchfile: 'Bt', Makefile: 'Mk', Dockerfile: 'Dk',
  'Jupyter Notebook': 'Jp', SCSS: 'Sc', MDX: 'Mx', Markdown: 'Md',
  mcfunction: 'mc', 'Common Lisp': 'CL', NewLisp: 'NL', Lisp: 'Ls',
  YAML: 'YL', JSON: 'JN', TOML: 'TM',
};
export function langAbbr(name) {
  if (LANG_ABBR[name]) return LANG_ABBR[name];
  const cleaned = String(name || '').replace(/[^A-Za-z0-9]/g, '');
  return cleaned.slice(0, 2) || '?';
}

// Pick black/white text for a given hex background using YIQ — keeps
// the abbreviation readable on bright colours (yellow JS, etc.).
export function langTextColor(hex) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? '#1a1a1a' : '#ffffff';
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

// Optional GitHub API access token (populated from
// github-oauth.js#getGithubToken → main.js at boot). When present it
// gets attached as a Bearer header so every GitHub API call goes
// through the authenticated 5000/h ceiling instead of the anonymous
// 60/h one; Search API rises from 10 → 30 req/min. Falls back to
// anonymous the moment it goes missing (token refresh dropped it,
// user unlinked, etc).
const GH_TOKEN_STORAGE_KEY = 'spotcode.github_api_token';
let ghApiToken = null;
export function setGithubApiToken(token, ownerId = '') {
  ghApiToken = token || null;
  // Supabase drops provider_token when its own session refreshes. Keep the
  // GitHub grant for this browser tab so navigation/reloads do not randomly
  // disable private issues. sessionStorage clears when the tab is closed.
  try {
    if (ghApiToken && ownerId) window.sessionStorage.setItem(
      GH_TOKEN_STORAGE_KEY, JSON.stringify({ token: ghApiToken, ownerId })
    );
    else window.sessionStorage.removeItem(GH_TOKEN_STORAGE_KEY);
  } catch {}
}
export function hasGithubApiToken() { return !!ghApiToken; }
export function restoreGithubApiToken(ownerId) {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(GH_TOKEN_STORAGE_KEY) || 'null');
    if (!saved?.token || saved.ownerId !== ownerId) return null;
    ghApiToken = saved.token;
    return ghApiToken;
  } catch { return null; }
}

// Exported so other GitHub-data views (e.g. /repos) share the same
// rate-limit cooldown. When this helper trips RATE_LIMIT, every caller
// in the app starts returning cached/empty for the next hour instead
// of each one independently hammering the 60/h IP budget.
export async function fetchJson(url, timeoutMs = 10000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const headers = { 'Accept': 'application/vnd.github+json' };
    if (ghApiToken) headers['Authorization'] = 'Bearer ' + ghApiToken;
    const r = await fetch(url, { headers, signal: ctl.signal });
    // 401 with a token typically means the token expired / was
    // revoked. Drop it so subsequent calls don't keep sending a
    // known-bad credential (which GitHub eventually rate-limits
    // separately from the anon budget).
    if (r.status === 401 && ghApiToken) {
      setGithubApiToken(null);
    }
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

// Public entry. Returns
//   { langs: [['TypeScript', 12345], …],
//     total, repoCounts: { TypeScript: 8, … } }
// repoCounts is the number of scanned repos that contain the
// language — used by the profile medals to render the GitHub-
// Achievements-style ×N stack indicator.
export async function getLanguageStats(handle) {
  if (!handle) return { langs: [], total: 0, repoCounts: {} };
  const cached = cacheFor(handle);
  if (cached) return cached;
  if (Date.now() < rateLimitedUntil) return cached || { langs: [], total: 0, repoCounts: {} };

  // Skip org accounts — the personal language stats only make sense
  // for individual users. type=Organization comes back from /users/X.
  let meta;
  try { meta = await fetchJson('https://api.github.com/users/' + encodeURIComponent(handle)); }
  catch { meta = null; }
  if (meta?.type === 'Organization') {
    const empty = { langs: [], total: 0, repoCounts: {} };
    storeCache(handle, empty);
    return empty;
  }
  if (Date.now() < rateLimitedUntil) return { langs: [], total: 0, repoCounts: {} };

  const repos = await gatherRepos(handle);

  // Per-repo /languages calls in parallel (the same set GitHub
  // computes for the repo's own language bar). Track both the total
  // byte sum and the repo-occurrence count per language.
  const langBytes  = Object.create(null);
  const repoCounts = Object.create(null);
  await Promise.all(repos.map(async (r) => {
    let langs;
    try {
      langs = await fetchJson('https://api.github.com/repos/' + r.fullName + '/languages');
    } catch { return; }
    for (const [name, bytes] of Object.entries(langs || {})) {
      langBytes[name]  = (langBytes[name]  || 0) + (Number(bytes) || 0);
      repoCounts[name] = (repoCounts[name] || 0) + 1;
    }
  }));

  const sorted = Object.entries(langBytes).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((a, [, b]) => a + b, 0);
  const value = { langs: sorted, total, repoCounts };

  // Don't poison the cache with an empty result that came from a
  // mid-flight rate-limit; let the next visit retry instead.
  if (!sorted.length && Date.now() < rateLimitedUntil) return value;
  storeCache(handle, value);
  return value;
}
