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
const CACHE_KEY = 'spotcode:badges_cache:v2';
const TTL_MS    = 24 * 60 * 60 * 1000;
const MAX_REPOS_TO_SCAN = 12;

// Each badge:
//   id        — unique slug
//   name      — displayed text
//   tooltip   — explanation
//   exts      — file extensions to look for (lowercase, no dot)
//   minFiles  — how many qualifying files needed
//   minBytes  — minimum file size in bytes to qualify
//   tone      — chip color (accent / green / warn / danger / boost / like)
const BADGES = [
  { id: 'lisper', name: '始めたて Lisper', tooltip: '.lisp / .cl ファイルが 2 つ以上、各 100 バイト以上',
    exts: ['lisp','cl'], minFiles: 2, minBytes: 100, tone: 'warn' },
];

function readCache() { return read(CACHE_KEY, {}); }
function writeCache(o) { write(CACHE_KEY, o); }

function cacheFor(handle) {
  const all = readCache();
  const entry = all[handle];
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) return null;
  return entry.badges;
}

function storeCache(handle, badges) {
  const all = readCache();
  all[handle] = { ts: Date.now(), badges };
  writeCache(all);
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { 'Accept': 'application/vnd.github+json' } });
  if (r.status === 403) throw new Error('RATE_LIMIT');
  if (!r.ok) throw new Error('HTTP_' + r.status);
  return r.json();
}

// Pull repos the user has actually pushed to recently. The events
// feed only covers ~90 days, but it's the only public signal of
// "this person authored commits here" — owned-repo lists alone
// would miss every contribution to an org repo.
async function reposFromPushEvents(handle) {
  const out = new Map();
  let events;
  try {
    events = await fetchJson(
      'https://api.github.com/users/' + encodeURIComponent(handle) + '/events/public?per_page=100'
    );
  } catch { return out; }
  for (const ev of events || []) {
    if (ev.type !== 'PushEvent' || !ev.repo?.name) continue;
    const slash = ev.repo.name.indexOf('/');
    if (slash < 1) continue;
    const owner = ev.repo.name.slice(0, slash);
    const name  = ev.repo.name.slice(slash + 1);
    if (!out.has(ev.repo.name)) out.set(ev.repo.name, { owner, name, defaultBranch: null });
  }
  return out;
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

  const eventsRepos = await reposFromPushEvents(githubHandle);
  const ownedRepos  = await reposOwned(githubHandle);
  // Events first (most recent activity), then owned to backfill.
  // Slice after union so we keep the freshest signal under the cap.
  const combined = new Map(eventsRepos);
  for (const [k, v] of ownedRepos) if (!combined.has(k)) combined.set(k, v);
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
      earned.push({ id: b.id, name: b.name, tooltip: b.tooltip, tone: b.tone });
    }
  }

  storeCache(githubHandle, earned);
  return earned;
}

export function clearBadgeCache() { writeCache({}); }
