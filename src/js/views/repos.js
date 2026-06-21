// /repos — GitHub repositories owned by you + the people you follow,
// merged into one timeline-style list sorted by most-recently-pushed.
//
// Each card shows:
//   • repo name (links to GitHub) + owner
//   • short description
//   • primary language pill (color from language-stats palette)
//   • star count + "X 日前 push" relative time
//   • on-demand "spotcode-sns 内の投稿" — posts tagged with this repo
//     via Stage 30's posts.repo_full_name. Empty state when no posts
//     are tagged (the compose-side tagging UI ships in a follow-up).
//
// Speed strategy (same shape as the profile language-medal hydration):
//   1. Synchronously read cached repo lists for self + every followed
//      user → paint whatever we have *before* any await. On a repeat
//      visit this means the list is filled the moment the JS runs.
//   2. Kick off `fetchUserRepos(handle)` per uncached handle in
//      parallel. As each one resolves, splice its repos into the
//      already-rendered list and re-sort. No `Promise.all` blocking
//      the first paint behind the slowest user.
//   3. Share `fetchJson` (rate-limit cooldown) with language-stats so
//      both views back off together when the public API 403s.
//
// Per-handle repo lists cache 1h in localStorage (mirroring
// language-stats.js's TTL). Cache key is namespaced so future schema
// bumps don't collide with the live entries.

import { currentUser }       from '../auth.js';
import { getClient }         from '../supa.js';
import { hydrateMyFollows, myFollowingHandles } from '../interactions.js';
import { langColor, fetchJson, isRateLimited } from '../language-stats.js';
import { postsWithGithubRefs, relTime } from '../data.js';
import { parseGithubLink } from '../gh-link.js';
import { icon }              from '../icons.js';
import { t }                 from '../i18n.js';
import { currentPath }       from '../router.js';

const REPOS_CACHE_KEY = 'spotcode:gh-repos-cache:v1';
const REPOS_TTL_MS    = 60 * 60 * 1000;       // 1 h
const MAX_REPOS_PER_USER = 12;

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(REPOS_CACHE_KEY) || '{}'); }
  catch { return {}; }
}
function writeCache(o) {
  try { localStorage.setItem(REPOS_CACHE_KEY, JSON.stringify(o)); }
  catch {}
}
function cachedUserRepos(ghHandle) {
  const all = readCache();
  const entry = all[ghHandle.toLowerCase()];
  if (!entry) return null;
  if (Date.now() - entry.at > REPOS_TTL_MS) return null;
  return entry.repos;
}
function storeUserRepos(ghHandle, repos) {
  const all = readCache();
  all[ghHandle.toLowerCase()] = { at: Date.now(), repos };
  writeCache(all);
}

function shapeRepo(r, fallbackOwner) {
  return {
    fullName:   r.full_name,
    name:       r.name,
    owner:      r.owner?.login || fallbackOwner,
    description:r.description || '',
    language:   r.language || null,
    stars:      r.stargazers_count || 0,
    pushedAt:   r.pushed_at ? new Date(r.pushed_at).getTime() : 0,
    htmlUrl:    r.html_url,
  };
}

// Public fetcher — reuses language-stats's fetchJson so the
// app-wide rate-limit cooldown propagates here. Returns [] (and
// caches []) on any failure so a single 404 / network blip doesn't
// keep retrying every render.
async function fetchUserRepos(ghHandle) {
  if (isRateLimited()) return cachedUserRepos(ghHandle) || [];
  const url = 'https://api.github.com/users/' + encodeURIComponent(ghHandle) +
              '/repos?sort=pushed&type=owner&per_page=' + MAX_REPOS_PER_USER;
  let raw;
  try { raw = await fetchJson(url); }
  catch { return cachedUserRepos(ghHandle) || []; }
  const repos = (raw || [])
    .filter((r) => !r.fork && !r.private)
    .map((r) => shapeRepo(r, ghHandle));
  storeUserRepos(ghHandle, repos);
  return repos;
}

// Pull github_handle for the given app handles in one round trip.
// Returns { appHandle → githubHandle | null }.
async function ghHandlesForUsers(appHandles) {
  const out = {};
  if (!appHandles.length) return out;
  let supa; try { supa = await getClient(); } catch { return out; }
  const { data, error } = await supa
    .from('profiles')
    .select('handle, github_handle')
    .in('handle', appHandles);
  if (error || !data) return out;
  for (const row of data) {
    out[row.handle] = row.github_handle || null;
  }
  return out;
}

// Per-hydrate map of fullName (lower-cased) → posts[]. Filled once
// at hydrate from postsWithGithubRefs(), then read synchronously by
// renderRepoCard so re-paints don't need to re-query Supabase.
//
// `postsLoaded` flips true after the single Supabase round-trip
// resolves so renderPostsSection can tell "still loading" apart
// from "loaded, no posts for this repo".
let postsByFullName = new Map();
let postsLoaded = false;

function renderPostsSection(fullName) {
  if (!postsLoaded) {
    return '<p class="repo-card__posts-loading">' + t('repos.posts.loading') + '</p>';
  }
  const posts = postsByFullName.get(fullName.toLowerCase()) || [];
  if (!posts.length) {
    return '<p class="repo-card__posts-empty">' + t('repos.posts.empty') + '</p>';
  }
  return (
    '<h3 class="repo-card__posts-title">' +
      t('repos.posts.heading').replace('{n}', String(posts.length)) +
    '</h3>' +
    posts.slice(0, 5).map(renderPostLink).join('')
  );
}

// Derive owner/repo for a post: explicit `repoFullName` wins;
// otherwise parse the GitHub link out of `githubLink`. Returns the
// lower-cased fullName or null. Used both for grouping and to ignore
// posts that don't point at a parseable repo.
function repoFullNameForPost(p) {
  if (p.repoFullName) return p.repoFullName.toLowerCase();
  if (p.githubLink) {
    const parsed = parseGithubLink(p.githubLink);
    if (parsed) return (parsed.owner + '/' + parsed.repo).toLowerCase();
  }
  return null;
}

function renderRepoCard(repo) {
  const lang = repo.language
    ? '<span class="repo-card__lang" style="--lang-color:' + langColor(repo.language) + '">' +
        '<span class="repo-card__lang-dot"></span>' + escape(repo.language) +
      '</span>'
    : '';
  const stars = repo.stars
    ? '<span class="repo-card__stat">' + icon('star', { size: 12, className: 'icon--inline' }) +
        ' ' + repo.stars.toLocaleString() + '</span>'
    : '';
  const pushed = repo.pushedAt
    ? '<span class="repo-card__stat">' + escape(relTime(repo.pushedAt)) + '</span>'
    : '';
  const desc = repo.description
    ? '<p class="repo-card__desc">' + escape(repo.description) + '</p>'
    : '';
  return (
    '<article class="repo-card" data-repo="' + escape(repo.fullName) + '">' +
      '<header class="repo-card__head">' +
        '<a class="repo-card__title" href="' + escape(repo.htmlUrl) + '" target="_blank" rel="noopener">' +
          icon('repo', { size: 16, className: 'icon--inline' }) +
          ' <span class="repo-card__owner">' + escape(repo.owner) + '</span>' +
          '<span class="repo-card__slash">/</span>' +
          '<span class="repo-card__name">' + escape(repo.name) + '</span>' +
        '</a>' +
      '</header>' +
      desc +
      '<footer class="repo-card__meta">' + lang + stars + pushed + '</footer>' +
      '<section class="repo-card__posts" data-repo-posts="' + escape(repo.fullName) + '">' +
        renderPostsSection(repo.fullName) +
      '</section>' +
    '</article>'
  );
}

function renderPostLink(p) {
  const body = (p.body || '').slice(0, 120);
  const tail = (p.body || '').length > 120 ? '…' : '';
  const author = p.author?.handle ? '@' + p.author.handle : '';
  return (
    '<a class="repo-card__post" href="/post/' + escape(p.id) + '">' +
      '<span class="repo-card__post-author">' + escape(author) + '</span>' +
      '<span class="repo-card__post-body">' + escape(body) + tail + '</span>' +
    '</a>'
  );
}

export function renderRepos() {
  return (
    '<div class="repos-head">' +
      '<div class="repos-head__icon">' + icon('repo', { size: 28 }) + '</div>' +
      '<h2 class="repos-head__title">' + t('repos.title') + '</h2>' +
      '<p class="repos-head__sub">' + t('repos.subtitle') + '</p>' +
    '</div>' +
    '<div id="repos-list" class="repos-list">' +
      '<p class="stub__sub">' + t('repos.loading') + '</p>' +
    '</div>'
  );
}

// Tiny guard so a slow GitHub fetch landing after the user has
// navigated away doesn't overwrite the next view's DOM.
function stillHere() { return currentPath() === '/repos' || currentPath() === '/repos/'; }

// requestAnimationFrame batcher. With ~20 followed users we can get
// ~20 fetchUserRepos.then() resolves in a single tick — calling
// paintList() once per resolve means rebuilding the entire list's
// innerHTML 20 times in the same frame, which janks scrolling and
// any in-progress UI. Coalesce to one paint per frame.
//
// We hand the Map (not a sorted array) to the scheduler so the
// callback always sorts the LATEST contents — intermediate resolves
// in the same frame don't pay for an extra sort each.
let pendingMap   = null;
let pendingList  = null;
let paintFrame   = 0;
function schedulePaint(list, workingMap) {
  pendingList = list;
  pendingMap  = workingMap;
  if (paintFrame) return;
  paintFrame = requestAnimationFrame(() => {
    paintFrame = 0;
    const l = pendingList;
    const m = pendingMap;
    pendingList = null;
    pendingMap  = null;
    if (!l || !l.isConnected) return;
    const sorted = Array.from(m.values()).sort((a, b) => b.pushedAt - a.pushedAt);
    l.innerHTML = sorted.map(renderRepoCard).join('');
  });
}

// Synchronous variant for the very first paint (we want it in the
// same tick the user lands on the page). All subsequent paints from
// the streaming-fetch loop go through schedulePaint.
function paintListNow(list, working) {
  list.innerHTML = working.map(renderRepoCard).join('');
}

// Refresh just the posts sections of every visible repo card. Called
// once after the single postsWithGithubRefs() round trip lands, so
// every card transitions from "読み込み中" to either the post list
// or the empty state in one go.
function refreshAllPostsSections(list) {
  list.querySelectorAll('[data-repo-posts]').forEach((slot) => {
    const fullName = slot.getAttribute('data-repo-posts');
    slot.innerHTML = renderPostsSection(fullName);
  });
}

export async function hydrateRepos() {
  const list = document.getElementById('repos-list');
  if (!list) return;

  const me = currentUser();
  if (!me) {
    list.innerHTML = '<div class="stub"><p class="stub__sub">' + t('repos.signin') + '</p></div>';
    return;
  }

  // Warm followsMine before reading it. Cheap no-op if it already ran
  // for this user since the last cache clear.
  try { await hydrateMyFollows(); } catch {}
  if (!stillHere()) return;

  // Self + people you follow. Self is always first in the lookup so
  // their repos sort naturally with everyone else's by pushed_at.
  const appHandles = Array.from(new Set([me.handle, ...myFollowingHandles()].filter(Boolean)));
  const ghMap = await ghHandlesForUsers(appHandles);
  if (!stillHere()) return;

  const ghHandles = appHandles
    .map((h) => ghMap[h])
    .filter(Boolean);
  if (!ghHandles.length) {
    list.innerHTML = '<div class="stub"><p class="stub__sub">' + t('repos.empty.no_gh') + '</p></div>';
    return;
  }

  // ----- Step 1: instant paint from cache --------------------------
  // Read whatever each handle has cached and paint it before any
  // network call. On a repeat visit this means the user sees the full
  // list with zero spinner.
  // Reset per-hydrate post state so a previous /repos visit's data
  // can't leak into this one (the user might have made new posts in
  // the interim).
  postsByFullName = new Map();
  postsLoaded = false;

  // Kick off the single posts round-trip immediately, parallel with
  // the github_handle lookup below. It rarely beats the GitHub repo
  // fetches, but on a warm GitHub cache it's the limiting step, so
  // starting it first matters.
  postsWithGithubRefs({ limit: 200 })
    .then((posts) => {
      const map = new Map();
      for (const p of posts) {
        const key = repoFullNameForPost(p);
        if (!key) continue;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(p);
      }
      postsByFullName = map;
      postsLoaded = true;
      if (stillHere()) refreshAllPostsSections(list);
    })
    .catch(() => {
      // Posts lookup failed — flip loaded so cards show empty state
      // instead of an eternal「読み込み中」.
      postsLoaded = true;
      if (stillHere()) refreshAllPostsSections(list);
    });

  const working = new Map();    // fullName → repo
  const needFetch = [];
  for (const gh of ghHandles) {
    const cached = cachedUserRepos(gh);
    if (cached) for (const r of cached) working.set(r.fullName, r);
    else needFetch.push(gh);
  }
  const initialSorted = Array.from(working.values()).sort((a, b) => b.pushedAt - a.pushedAt);
  if (initialSorted.length) paintListNow(list, initialSorted);

  // ----- Step 2: stream missing fetches ----------------------------
  // Fire each uncached fetch independently; re-paint the list as each
  // resolves. Promise.all would have blocked the first paint behind
  // the slowest user.
  if (needFetch.length === 0) {
    if (initialSorted.length === 0) {
      list.innerHTML = '<div class="stub"><p class="stub__sub">' + t('repos.empty.no_repos') + '</p></div>';
    }
    return;
  }

  let landed = 0;
  for (const gh of needFetch) {
    fetchUserRepos(gh).then((repos) => {
      landed++;
      if (!stillHere()) return;
      for (const r of repos) working.set(r.fullName, r);
      if (working.size === 0 && landed === needFetch.length) {
        list.innerHTML = '<div class="stub"><p class="stub__sub">' + t('repos.empty.no_repos') + '</p></div>';
        return;
      }
      schedulePaint(list, working);
    }).catch(() => { landed++; });
  }
}
