// Profile badges derived from a user's public GitHub repos.
//
// We scan repositories via the unauthenticated REST API (60 req/h per IP)
// and award a badge when the user has N+ files of a given extension that
// are at least M bytes each. Results are cached in localStorage for 24h
// so navigating between profile pages doesn't burn through the quota.

import { read, write } from './storage.js';

const CACHE_KEY = 'spotcode:badges_cache';
const TTL_MS    = 24 * 60 * 60 * 1000;

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

// Returns earned badges asynchronously. Cached results come back instantly;
// fresh scans walk the user's most recently pushed repos in parallel.
export async function getBadges(githubHandle) {
  if (!githubHandle) return [];
  const cached = cacheFor(githubHandle);
  if (cached) return cached;

  let repos;
  try {
    repos = await fetchJson(
      'https://api.github.com/users/' + encodeURIComponent(githubHandle) +
      '/repos?per_page=30&sort=pushed&type=owner'
    );
  } catch { return []; }

  // Cap at ~12 most-recent non-fork repos to stay within the rate limit.
  const counts = Object.create(null);
  const probe  = repos.filter(r => !r.fork).slice(0, 12);

  await Promise.all(probe.map(async (repo) => {
    if (!repo.default_branch) return;
    let tree;
    try {
      tree = await fetchJson(
        'https://api.github.com/repos/' + repo.owner.login + '/' + repo.name +
        '/git/trees/' + encodeURIComponent(repo.default_branch) + '?recursive=1'
      );
    } catch { return; }
    if (!tree || !Array.isArray(tree.tree)) return;

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
