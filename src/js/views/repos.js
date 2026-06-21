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
// Data sources:
//   • Profile rows  → Supabase  (select handle, github_handle for self
//                                + followed handles)
//   • Repo metadata → GitHub public API (/users/{h}/repos, sorted by
//                                       pushed; 30/h, IP-rate-limited)
//   • Per-repo posts → Supabase (postsByRepo, Stage 30)
//
// Per-handle repo lists cache 1h in localStorage so the page paints
// instantly on the second visit (mirroring language-stats.js).

import { currentUser }       from '../auth.js';
import { getClient }         from '../supa.js';
import { hydrateMyFollows, myFollowingHandles } from '../interactions.js';
import { langColor }         from '../language-stats.js';
import { postsByRepo, relTime } from '../data.js';
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
function cachedRepos(ghHandle) {
  const all = readCache();
  const entry = all[ghHandle.toLowerCase()];
  if (!entry) return null;
  if (Date.now() - entry.at > REPOS_TTL_MS) return null;
  return entry.repos;
}
function storeRepos(ghHandle, repos) {
  const all = readCache();
  all[ghHandle.toLowerCase()] = { at: Date.now(), repos };
  writeCache(all);
}

async function fetchRepos(ghHandle) {
  const cached = cachedRepos(ghHandle);
  if (cached) return cached;
  const url = 'https://api.github.com/users/' + encodeURIComponent(ghHandle) +
              '/repos?sort=pushed&type=owner&per_page=' + MAX_REPOS_PER_USER;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  let raw;
  try {
    const r = await fetch(url, {
      headers: { 'Accept': 'application/vnd.github+json' },
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error('HTTP_' + r.status);
    raw = await r.json();
  } catch { return []; }
  finally { clearTimeout(timer); }
  const repos = (raw || [])
    .filter((r) => !r.fork && !r.private)
    .map((r) => ({
      fullName:   r.full_name,
      name:       r.name,
      owner:      r.owner?.login || ghHandle,
      ownerAvatar: r.owner?.avatar_url || null,
      description:r.description || '',
      language:   r.language || null,
      stars:      r.stargazers_count || 0,
      pushedAt:   r.pushed_at ? new Date(r.pushed_at).getTime() : 0,
      htmlUrl:    r.html_url,
    }));
  storeRepos(ghHandle, repos);
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
        '<p class="repo-card__posts-loading">' + t('repos.posts.loading') + '</p>' +
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

export async function hydrateRepos() {
  const list = document.getElementById('repos-list');
  if (!list) return;

  const me = currentUser();
  if (!me) {
    list.innerHTML = '<div class="stub"><p class="stub__sub">' + t('repos.signin') + '</p></div>';
    return;
  }

  // Make sure followsMine is warm before we read it. hydrateMyFollows
  // is a no-op if it already ran for the current user.
  try { await hydrateMyFollows(); } catch {}
  if (!stillHere()) return;

  // Self + people you follow. Self is always first in the lookup so
  // their repos sort naturally with everyone else's by pushed_at.
  const appHandles = [me.handle, ...myFollowingHandles()].filter(Boolean);
  const uniqueAppHandles = Array.from(new Set(appHandles));
  const ghMap = await ghHandlesForUsers(uniqueAppHandles);
  if (!stillHere()) return;

  const ghHandles = uniqueAppHandles
    .map((h) => ghMap[h])
    .filter(Boolean);
  if (!ghHandles.length) {
    list.innerHTML = '<div class="stub"><p class="stub__sub">' + t('repos.empty.no_gh') + '</p></div>';
    return;
  }

  // Parallel-fetch all users' repos. Each promise is independent and
  // failures already return [] from fetchRepos.
  const lists = await Promise.all(ghHandles.map(fetchRepos));
  if (!stillHere()) return;
  const repos = lists.flat()
    .sort((a, b) => b.pushedAt - a.pushedAt);

  if (!repos.length) {
    list.innerHTML = '<div class="stub"><p class="stub__sub">' + t('repos.empty.no_repos') + '</p></div>';
    return;
  }

  list.innerHTML = repos.map(renderRepoCard).join('');

  // Per-repo post lookup. Fire-and-forget; each lookup updates its own
  // card slot when it lands. We don't await the array so the first
  // repos paint immediately and slow ones don't block the rest.
  for (const repo of repos) {
    postsByRepo(repo.fullName).then((posts) => {
      if (!stillHere()) return;
      const slot = list.querySelector('[data-repo-posts="' + CSS.escape(repo.fullName) + '"]');
      if (!slot) return;
      if (!posts.length) {
        slot.innerHTML = '<p class="repo-card__posts-empty">' + t('repos.posts.empty') + '</p>';
        return;
      }
      slot.innerHTML =
        '<h3 class="repo-card__posts-title">' +
          t('repos.posts.heading').replace('{n}', String(posts.length)) +
        '</h3>' +
        posts.slice(0, 5).map(renderPostLink).join('');
    }).catch(() => {});
  }
}
