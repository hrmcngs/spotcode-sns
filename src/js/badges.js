// Profile badges derived from a user's public GitHub activity.
//
// Badges attribute *what the person wrote*, not *what their employer
// owns*: scanning only `users/{handle}/repos?type=owner` misses
// contributors to org-owned repos entirely, so someone who pushes
// .lisp into `acme/lispy-thing` got no Lisper badge unless they
// also kept a personal lisp repo. We now union recent PushEvents
// with the owned-repo list before scanning trees.
//
// Org accounts on GitHub (type=Organization) are skipped entirely —
// these badges belong to people, not containers.
//
// All requests are unauthenticated REST (60 req/h per IP). Results
// are cached in localStorage for 24h so navigating between profile
// pages doesn't burn through the quota.

import { read, write } from './storage.js';

// v2: switched derivation from owned-repos-only to events ∪ owned and
// added the GitHub-org skip. Bumped so stale empty-badge results
// from the v1 logic don't linger 24h before re-checking.
// v3: expanded the BADGES table beyond just lisp, so the cached empty
// arrays from v2 (where most users earned nothing and the row was
// hidden entirely) need to re-resolve against the new badge set.
// v5: badge object shape changed (added abbr + colour for the
// GitHub-achievement-style medal render; dropped the chip `tone`
// field), so v3/v4 cached arrays don't carry the fields the new
// renderer needs and would paint as colour-less circles.
// v8: bump to force-invalidate every "stuck-empty" cache entry from
// the v7 era — v7 deployed alongside the 30+ API call per profile
// fan-out, which made the unauth 60/h rate limit trivial to hit and
// poisoned a lot of caches with empty arrays. Without a bump, those
// users would wait up to the EMPTY_TTL_MS (10 min) for self-heal.
const CACHE_KEY = 'spotcode:badges_cache:v8';
const TTL_MS       = 24 * 60 * 60 * 1000;
// Empty results expire fast so a transient rate-limit (or a hiccup
// during the recent v7 cache-busts) doesn't lock a real user out of
// their badges for a full day.
const EMPTY_TTL_MS = 10 * 60 * 1000;
const MAX_REPOS_TO_SCAN = 12;

// Module-level rate-limit cooldown. Set when fetchJson sees a 403
// from GitHub; while it's in effect, getBadges short-circuits to
// whatever the cache holds (empty or stale) instead of burning more
// requests. Cleared by the next fetchJson that succeeds.
let rateLimitedUntil = 0;
const RATE_LIMIT_COOLDOWN_MS = 60 * 60 * 1000;

// Each badge:
//   id        — unique slug
//   name      — displayed text
//   tooltip   — explanation
//   abbr      — 2-char glyph fallback when the icon image fails to load
//   colour    — solid hex used for the medal background
//   iconSlug  — Simple Icons (CC0) slug used to render the language
//               logo inside the medal via cdn.simpleicons.org. Fetched
//               at runtime so we don't bundle the SVG paths.
//   exts      — file extensions to look for (lowercase, no dot)
//   minFiles  — how many qualifying files needed to *earn* the badge
//   minBytes  — minimum file size in bytes to qualify
// Threshold is intentionally low (2 files of 100 bytes each) — these
// are "you've started" badges, not "you're a senior". A new sign-up
// who's been pushing to *anything* should pick up at least one within
// their first few sessions, otherwise the badges row vanishes and
// looks broken. Names use the existing 「始めたて X」 motif. Colours
// match the conventional language palette where one exists so the
// medal is recognisable at a glance.
const BADGES = [
  { id: 'lisper',       name: '始めたて Lisper',        abbr: 'Lp', colour: '#8a4cc4',
    iconSlug: 'commonlisp',
    tooltip: '.lisp / .cl ファイルが 2 つ以上、各 100 バイト以上',
    exts: ['lisp','cl'],                                minFiles: 2, minBytes: 100 },
  { id: 'typescripter', name: '始めたて TypeScripter',  abbr: 'Ts', colour: '#3178c6',
    iconSlug: 'typescript',
    tooltip: '.ts / .tsx ファイルが 2 つ以上、各 100 バイト以上',
    exts: ['ts','tsx'],                                 minFiles: 2, minBytes: 100 },
  { id: 'jser',         name: '始めたて JavaScripter',  abbr: 'Js', colour: '#f1e05a',
    iconSlug: 'javascript',
    tooltip: '.js / .jsx / .mjs ファイルが 2 つ以上、各 100 バイト以上',
    exts: ['js','jsx','mjs'],                           minFiles: 2, minBytes: 100 },
  { id: 'pythoneer',    name: '始めたて Pythoneer',     abbr: 'Py', colour: '#3776ab',
    iconSlug: 'python',
    tooltip: '.py ファイルが 2 つ以上、各 100 バイト以上',
    exts: ['py'],                                       minFiles: 2, minBytes: 100 },
  { id: 'rustacean',    name: '始めたて Rustacean',     abbr: 'Rs', colour: '#dea584',
    iconSlug: 'rust',
    tooltip: '.rs ファイルが 2 つ以上、各 100 バイト以上',
    exts: ['rs'],                                       minFiles: 2, minBytes: 100 },
  { id: 'gopher',       name: '始めたて Gopher',        abbr: 'Go', colour: '#00add8',
    iconSlug: 'go',
    tooltip: '.go ファイルが 2 つ以上、各 100 バイト以上',
    exts: ['go'],                                       minFiles: 2, minBytes: 100 },
  { id: 'javaer',       name: '始めたて Java/Kotlin',   abbr: 'Jv', colour: '#b07219',
    iconSlug: 'openjdk',
    tooltip: '.java / .kt ファイルが 2 つ以上、各 100 バイト以上',
    exts: ['java','kt'],                                minFiles: 2, minBytes: 100 },
  { id: 'cppr',         name: '始めたて C/C++',         abbr: 'C+', colour: '#5e6cb0',
    iconSlug: 'cplusplus',
    tooltip: '.c / .cc / .cpp / .h / .hpp ファイルが 2 つ以上、各 100 バイト以上',
    exts: ['c','cc','cpp','h','hpp'],                   minFiles: 2, minBytes: 100 },
  { id: 'webmaker',     name: '始めたて Web Maker',     abbr: 'Wb', colour: '#e34c26',
    iconSlug: 'html5',
    tooltip: '.html / .css / .scss ファイルが 2 つ以上、各 100 バイト以上',
    exts: ['html','htm','css','scss'],                  minFiles: 2, minBytes: 100 },
  { id: 'gamedev',      name: '始めたて Game Dev',      abbr: 'Gd', colour: '#c84d96',
    iconSlug: 'godotengine',
    tooltip: '.gd / .lua / .cs / .pde ファイルが 2 つ以上、各 100 バイト以上',
    exts: ['gd','lua','cs','pde'],                      minFiles: 2, minBytes: 100 },
  { id: 'shellr',       name: '始めたて Shell Hacker',  abbr: 'Sh', colour: '#4eaa25',
    iconSlug: 'gnubash',
    tooltip: '.sh / .bash / .zsh ファイルが 2 つ以上、各 100 バイト以上',
    exts: ['sh','bash','zsh'],                          minFiles: 2, minBytes: 100 },
];

// Tier ladder. Mirrors GitHub's "x4 / x3" achievement counters
// but expressed as named tiers because that's clearer to a JP user
// than a raw multiplier. Counts measure qualifying files across the
// scanned repo set, not commits.
const TIERS = [
  { id: 'bronze',   nameJa: 'ブロンズ', nameEn: 'Bronze',   min: 2 },
  { id: 'silver',   nameJa: 'シルバー', nameEn: 'Silver',   min: 6 },
  { id: 'gold',     nameJa: 'ゴールド', nameEn: 'Gold',     min: 16 },
  { id: 'platinum', nameJa: 'プラチナ', nameEn: 'Platinum', min: 50 },
];
function tierFor(count) {
  let t = TIERS[0];
  for (const cand of TIERS) if (count >= cand.min) t = cand;
  return t;
}

function readCache() { return read(CACHE_KEY, {}); }
function writeCache(o) { write(CACHE_KEY, o); }

function cacheFor(handle) {
  const all = readCache();
  const entry = all[handle];
  if (!entry) return null;
  // Empty results get a much shorter TTL (10 min) so a transient
  // rate-limit or hiccup doesn't poison the cache for a full day.
  const ttl = (Array.isArray(entry.badges) && entry.badges.length === 0) ? EMPTY_TTL_MS : TTL_MS;
  if (Date.now() - entry.ts > ttl) return null;
  return entry.badges;
}

function storeCache(handle, badges) {
  const all = readCache();
  all[handle] = { ts: Date.now(), badges };
  writeCache(all);
}

// Every GitHub fetch goes through here, so a hung request can't
// silently lock the whole badge resolution. The 10s AbortController
// timeout converts a hang into an AbortError, which the callers'
// try/catch wrappers then handle the same as any other failure.
async function fetchJson(url, timeoutMs = 10000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { 'Accept': 'application/vnd.github+json' },
      signal: ctl.signal,
    });
    if (r.status === 403) {
      // GitHub usually 403s with a rate-limit reason. Mark the
      // cooldown so getBadges can short-circuit the rest of the
      // chain instead of doing 30+ more doomed fetches.
      rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
      throw new Error('RATE_LIMIT');
    }
    if (!r.ok) throw new Error('HTTP_' + r.status);
    // A successful request means the limit has reset — clear any
    // stale cooldown so subsequent visits work even when the
    // 60-min timer hasn't elapsed.
    if (rateLimitedUntil) rateLimitedUntil = 0;
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

// Pull repos the user has actually pushed to recently AND the set
// of owner accounts those repos belong to. The events feed only
// covers ~90 days, but it's the only public signal of "this person
// authored commits here" — owned-repo lists alone would miss every
// contribution to an org repo.
//
// The owners set feeds reposFromOrgs below, which catches org repos
// even when the user has their membership set to private (the
// GitHub default for new orgs).
async function reposFromPushEvents(handle) {
  const repos  = new Map();
  const owners = new Set();
  let events;
  try {
    events = await fetchJson(
      'https://api.github.com/users/' + encodeURIComponent(handle) + '/events/public?per_page=100'
    );
  } catch { return { repos, owners }; }
  for (const ev of events || []) {
    if (ev.type !== 'PushEvent' || !ev.repo?.name) continue;
    const slash = ev.repo.name.indexOf('/');
    if (slash < 1) continue;
    const owner = ev.repo.name.slice(0, slash);
    const name  = ev.repo.name.slice(slash + 1);
    if (!repos.has(ev.repo.name)) repos.set(ev.repo.name, { owner, name, defaultBranch: null });
    owners.add(owner);
  }
  return { repos, owners };
}

// Owned non-fork repos backfill the events list for users whose
// recent activity is older than ~90 days. Carries default_branch
// straight through so we don't need a per-repo metadata fetch.
async function reposOwned(handle) {
  const out = new Map();
  let repos;
  try {
    repos = await fetchJson(
      'https://api.github.com/users/' + encodeURIComponent(handle) +
      '/repos?per_page=30&sort=pushed&type=owner'
    );
  } catch { return out; }
  for (const r of repos || []) {
    if (r.fork) continue;
    const key = r.owner.login + '/' + r.name;
    if (!out.has(key)) {
      out.set(key, { owner: r.owner.login, name: r.name, defaultBranch: r.default_branch || null });
    }
  }
  return out;
}

// Public repos belonging to orgs the user is affiliated with.
//
// Two source paths, deduped into one candidate set:
//
//   1. /users/{handle}/orgs — authoritative for *public* memberships.
//      Most GitHub users keep their org memberships private (the
//      default for new joins), so this often returns []. That's why
//      we fall through to (2).
//   2. Owners of repos the user has pushed to in the events feed —
//      catches orgs where the user is a private member or a non-
//      member contributor.
//
// Candidates that turn out to be user accounts (not orgs) make
// /orgs/{name}/repos return 404; we silently skip them.
//
// Rate-limit caution: capped at MAX_ORGS_TO_SCAN candidates, each
// pulling MAX_REPOS_PER_ORG public non-forks. Net cost: 1 (orgs) +
// up to MAX_ORGS_TO_SCAN (per-org repos) = ≤4 extra API calls
// with the defaults below.
const MAX_ORGS_TO_SCAN  = 3;
const MAX_REPOS_PER_ORG = 6;
async function reposFromOrgs(handle, eventOwners) {
  const out = new Map();
  const candidates = new Set();

  // (1) Public memberships — authoritative when available.
  try {
    const orgs = await fetchJson(
      'https://api.github.com/users/' + encodeURIComponent(handle) + '/orgs?per_page=' + MAX_ORGS_TO_SCAN
    );
    for (const o of (orgs || [])) if (o && o.login) candidates.add(o.login);
  } catch {}

  // (2) Inferred from event-feed owners. Some are users (not orgs);
  //     /orgs/.../repos returns 404 for those and we skip below.
  const handleLc = String(handle || '').toLowerCase();
  for (const owner of (eventOwners || [])) {
    if (owner && owner.toLowerCase() !== handleLc) candidates.add(owner);
  }

  const list = Array.from(candidates).slice(0, MAX_ORGS_TO_SCAN);
  // Sequential to keep the rate-limit budget predictable.
  for (const org of list) {
    let repos;
    try {
      repos = await fetchJson(
        'https://api.github.com/orgs/' + encodeURIComponent(org) +
        '/repos?per_page=' + MAX_REPOS_PER_ORG + '&sort=pushed&type=public'
      );
    } catch { continue; } // 404 = candidate is a user account, not an org
    for (const r of (repos || [])) {
      if (r.fork) continue;
      const key = r.owner.login + '/' + r.name;
      if (!out.has(key)) {
        out.set(key, { owner: r.owner.login, name: r.name, defaultBranch: r.default_branch || null });
      }
    }
  }
  return out;
}

// Try the known default branch first, then common fallbacks. Avoids
// a per-repo metadata fetch when the branch came from the events
// feed (where the default branch isn't included).
async function fetchTree(owner, name, defaultBranch) {
  const branches = [];
  if (defaultBranch) branches.push(defaultBranch);
  if (!branches.includes('main'))   branches.push('main');
  if (!branches.includes('master')) branches.push('master');
  for (const b of branches) {
    try {
      const tree = await fetchJson(
        'https://api.github.com/repos/' + owner + '/' + name +
        '/git/trees/' + encodeURIComponent(b) + '?recursive=1'
      );
      if (tree && Array.isArray(tree.tree)) return tree;
    } catch {}
  }
  return null;
}

// Returns earned badges asynchronously. Cached results come back instantly;
// fresh scans union recent PushEvents + owned non-fork repos.
export async function getBadges(githubHandle) {
  if (!githubHandle) return [];
  const cached = cacheFor(githubHandle);
  if (cached) return cached;

  // GitHub is rate-limiting our IP — don't pile on another 30+
  // doomed requests; just hand back whatever the cache has (likely
  // empty) without writing to it, so the next visit after the
  // cooldown gets a real fetch.
  if (Date.now() < rateLimitedUntil) return [];

  // Personal-skill badges don't apply to GitHub Organization
  // accounts — those are containers, the actual code is written
  // by the contributors. Cache the empty result so we don't
  // re-check every time someone views an org profile.
  let userMeta;
  try {
    userMeta = await fetchJson('https://api.github.com/users/' + encodeURIComponent(githubHandle));
  } catch { userMeta = null; }
  if (userMeta?.type === 'Organization') {
    storeCache(githubHandle, []);
    return [];
  }
  // The userMeta fetch above may have just set the cooldown via
  // fetchJson. Bail before doing the expensive 30+ tree scans.
  if (Date.now() < rateLimitedUntil) return [];

  const { repos: eventsRepos, owners: eventOwners } = await reposFromPushEvents(githubHandle);
  const ownedRepos = await reposOwned(githubHandle);
  // reposFromOrgs(handle, eventOwners) catches org repos even when
  // the user's membership is private (the GitHub default) by
  // inferring candidate org names from owners of repos the user
  // pushed to.
  const orgRepos = await reposFromOrgs(githubHandle, eventOwners);
  // Priority: events (strongest) → owned → orgs (weakest). Slice
  // after union so the strongest signals are guaranteed to land in
  // the probe set under the MAX_REPOS_TO_SCAN cap.
  const combined = new Map(eventsRepos);
  for (const [k, v] of ownedRepos) if (!combined.has(k)) combined.set(k, v);
  for (const [k, v] of orgRepos)   if (!combined.has(k)) combined.set(k, v);
  const probe = Array.from(combined.values()).slice(0, MAX_REPOS_TO_SCAN);

  const counts = Object.create(null);
  await Promise.all(probe.map(async (repo) => {
    const tree = await fetchTree(repo.owner, repo.name, repo.defaultBranch);
    if (!tree) return;
    for (const node of tree.tree) {
      if (node.type !== 'blob' || typeof node.size !== 'number') continue;
      const idx = node.path.lastIndexOf('.');
      if (idx < 0) continue;
      const ext = node.path.slice(idx + 1).toLowerCase();
      counts[ext] = counts[ext] || { sizes: [] };
      counts[ext].sizes.push(node.size);
    }
  }));

  const earned = [];
  for (const b of BADGES) {
    let qualifying = 0;
    for (const ext of b.exts) {
      const bucket = counts[ext];
      if (!bucket || !bucket.sizes) continue;
      for (const sz of bucket.sizes) if (sz >= b.minBytes) qualifying++;
    }
    if (qualifying >= b.minFiles) {
      const tier = tierFor(qualifying);
      earned.push({
        id: b.id, name: b.name, tooltip: b.tooltip,
        abbr: b.abbr, colour: b.colour, iconSlug: b.iconSlug || null,
        exts: b.exts, count: qualifying,
        tier: tier.id, tierName: tier.nameJa,
      });
    }
  }

  // Don't cache an empty result that came from a mid-flight rate-
  // limit — otherwise a user who happens to load during a 403
  // burst gets locked out of their badges until the cache TTL.
  // Skipping the write means the next visit (after the cooldown)
  // does a fresh fetch.
  if (!earned.length && Date.now() < rateLimitedUntil) return [];
  storeCache(githubHandle, earned);
  return earned;
}

export function clearBadgeCache() { writeCache({}); }

// Sync read of the cache so renderProfile can paint the badge row
// straight from cached data on subsequent renders — without it, the
// row would flash back to the "loading" placeholder on every
// onAuthChange-triggered refresh().
export function cachedBadges(githubHandle) {
  if (!githubHandle) return null;
  return cacheFor(githubHandle);
}

// True while the module-level cooldown is active. Lets the UI tell
// the user "API rate-limited, try again later" instead of silently
// disappearing the section when getBadges returns [].
export function isRateLimited() {
  return Date.now() < rateLimitedUntil;
}
