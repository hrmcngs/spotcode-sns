// Posts data layer — now backed by public.posts in Supabase so timelines
// are shared across all devices. The functions stayed name-compatible
// with the localStorage era but every one is async now.
//
// Users (`allUsers`, `getUser`) still proxy through localStorage — the
// search-dropdown and profile.js already fetch from Supabase on demand
// and write into that cache.

import { KEYS, read, write } from './storage.js';
import { currentUser }       from './auth.js';
import { getClient }         from './supa.js';
import { isPostingAsOfficial } from './posting-identity.js';
import { getOfficialAccount }  from './official-account.js';

// ----- users (read-only cache shim, populated by profiles.js + auth.js) -----

export function allUsers() {
  const stored = read(KEYS.users, {});
  const me = currentUser();
  if (me && me.handle) return { ...stored, [me.handle]: me };
  return stored;
}

export function getUser(handle) {
  const me = currentUser();
  if (me && me.handle === handle) return me;
  return read(KEYS.users, {})[handle] || null;
}

// Debounced persistence of the users map. shapePost merges authors
// into the memoized map on every fetched row; one trailing write
// flushes the batch to localStorage.
let usersPersistTimer = null;
function scheduleUsersPersist() {
  if (usersPersistTimer) return;
  usersPersistTimer = setTimeout(() => {
    usersPersistTimer = null;
    write(KEYS.users, read(KEYS.users, {}));
  }, 250);
}

// In-memory {handle → auth-user id} cache. Filled by any place that
// already had to resolve a handle → id (fetchProfileByHandle sends id
// through cacheHandleId; the auth flow primes it too). Consumers like
// postsByHandle can skip the extra `profiles.select('id')` round trip
// when a hit exists — cutting profile-page fetch latency roughly in
// half, which matters a lot on flaky mobile networks that push the
// original 2-hop query past the 15s timeout.
const handleIdMap = new Map();
export function cacheHandleId(handle, id) {
  if (handle && id) handleIdMap.set(handle, id);
}
export function cachedHandleId(handle) {
  if (!handle) return null;
  // Own account: id is on cachedUser, always the freshest source.
  const me = currentUser();
  if (me && me.handle === handle && me.id) return me.id;
  return handleIdMap.get(handle) || null;
}

// ----- posts (Supabase) -----

// Pin the embed to the posts→profiles FK by its constraint name. Without
// the `!posts_author_id_fkey` hint PostgREST throws "more than one
// relationship was found" as soon as any other table also references
// profiles (likes, follows, reports, …) and its schema cache reloads.
//
// Stage 10 / 11 columns are appended by `postCols()` only when we
// know they exist in the deployed schema. If a query fails with
// "column … does not exist" we cache the negative + retry without
// it, so users who haven't run a migration yet still see posts.
//
// State persists in localStorage so the second page load doesn't have
// to rediscover the missing columns one round trip at a time.
//
// IMPORTANT: a TTL guards the cache. Without it, once any user hit a
// "column does not exist" error before the admin ran the migration,
// the false flag stuck FOREVER in that user's localStorage — even
// after the SQL was applied — and that user kept silently dropping
// the column from every request. The fix had to be "clear localStorage
// in DevTools", which obviously most users won't know to do.
//
// 1 hour is short enough that a migration propagates to all sessions
// within an hour, long enough to avoid retry-storming on a stable DB.
// v2: bumped so existing sessions with a stale `hasPhotos: false`
// cached from before the Stage 12 migration was applied re-probe and
// pick up the now-present column. Otherwise those clients silently
// drop `photos` from every SELECT and show photo posts as text-only.
const SCHEMA_CACHE_KEY = 'spotcode:schema-cache:v2';
const SCHEMA_CACHE_TTL_MS = 60 * 60 * 1000;

let hasCommentsCount  = true;
let hasRepostsCount   = true;
let hasBookmarksCount = true;
let hasQuotesCount    = true;
let hasQuoteOf        = true;
let hasPhotos         = true;
let hasPoll           = true;
let hasKind           = true;
let hasVisibility     = true;
let hasCloseFriends   = true;
let hasOrganization   = true;
let hasRepoFullName   = true;
let hasEventUrl       = true;

(function loadSchemaCache() {
  try {
    const v = JSON.parse(localStorage.getItem(SCHEMA_CACHE_KEY) || '{}');
    // Cache without a timestamp = legacy entry from before this TTL
    // was introduced; treat as expired so it self-heals on next load.
    if (!v.at || Date.now() - v.at > SCHEMA_CACHE_TTL_MS) return;
    if (v.hasCommentsCount  === false) hasCommentsCount  = false;
    if (v.hasRepostsCount   === false) hasRepostsCount   = false;
    if (v.hasBookmarksCount === false) hasBookmarksCount = false;
    if (v.hasQuotesCount    === false) hasQuotesCount    = false;
    if (v.hasQuoteOf        === false) hasQuoteOf        = false;
    if (v.hasPhotos         === false) hasPhotos         = false;
    if (v.hasPoll           === false) hasPoll           = false;
    if (v.hasKind           === false) hasKind           = false;
    if (v.hasVisibility     === false) hasVisibility     = false;
    if (v.hasCloseFriends   === false) hasCloseFriends   = false;
    if (v.hasOrganization   === false) hasOrganization   = false;
    if (v.hasRepoFullName   === false) hasRepoFullName   = false;
    if (v.hasEventUrl       === false) hasEventUrl       = false;
  } catch {}
})();
function persistSchemaCache() {
  try {
    localStorage.setItem(SCHEMA_CACHE_KEY, JSON.stringify({
      at: Date.now(),
      hasCommentsCount, hasRepostsCount, hasBookmarksCount, hasQuotesCount, hasQuoteOf,
      hasPhotos, hasPoll, hasKind, hasVisibility, hasCloseFriends, hasOrganization,
      hasRepoFullName, hasEventUrl,
    }));
  } catch {}
}

function postCols() {
  const extras = [];
  if (hasCommentsCount)  extras.push('comments_count');
  if (hasRepostsCount)   extras.push('reposts_count');
  if (hasBookmarksCount) extras.push('bookmarks_count');
  if (hasQuotesCount)    extras.push('quotes_count');
  if (hasQuoteOf)        extras.push('quote_of_post_id');
  if (hasPhotos)         extras.push('photos');
  if (hasPoll)           extras.push('poll');
  if (hasKind)           extras.push('kind');
  if (hasVisibility)     extras.push('visibility');
  if (hasRepoFullName)   extras.push('repo_full_name');
  if (hasEventUrl)       extras.push('event_url');
  const head =
    'id, body, github_link, spot, status, created_at' +
    (extras.length ? ', ' + extras.join(', ') : '');
  // Embedded author select. Kept minimal — the visibility audience
  // check (close_friends / organization) is enforced server-side via
  // Stage 18 RLS, so we don't need to leak those onto the API
  // response anymore.
  return head + ', author:profiles!posts_author_id_fkey(handle, name, avatar_url, avatar_shape)';
}

// Optional-column / table degradation map. Each entry: a substring
// that must appear in the error message + a side-effect that turns
// the corresponding postCols() entry off. Returns true on a hit so
// the caller knows to retry the query with the trimmed column list.
const OPTIONAL = [
  { needle: 'comments_count',   off: () => { if (hasCommentsCount)  { console.warn('posts.comments_count missing — run Stage 10 SQL.');  hasCommentsCount  = false; return true; } return false; } },
  { needle: 'reposts_count',    off: () => { if (hasRepostsCount)   { console.warn('posts.reposts_count missing — run Stage 11 SQL.');   hasRepostsCount   = false; return true; } return false; } },
  { needle: 'bookmarks_count',  off: () => { if (hasBookmarksCount) { console.warn('posts.bookmarks_count missing — run Stage 11 SQL.'); hasBookmarksCount = false; return true; } return false; } },
  { needle: 'quotes_count',     off: () => { if (hasQuotesCount)    { console.warn('posts.quotes_count missing — run Stage 11 SQL.');    hasQuotesCount    = false; return true; } return false; } },
  { needle: 'quote_of_post_id', off: () => { if (hasQuoteOf)        { console.warn('posts.quote_of_post_id missing — run Stage 11 SQL.'); hasQuoteOf      = false; return true; } return false; } },
  { needle: 'photos',           off: () => { if (hasPhotos)         { console.warn('posts.photos missing — run Stage 12 SQL: ALTER TABLE posts ADD COLUMN photos jsonb DEFAULT \'[]\'::jsonb.'); hasPhotos = false; return true; } return false; } },
  { needle: 'poll',             off: () => { if (hasPoll)           { console.warn('posts.poll missing — run Stage 13 SQL: ALTER TABLE posts ADD COLUMN poll jsonb.'); hasPoll = false; return true; } return false; } },
  { needle: 'kind',             off: () => { if (hasKind)           { console.warn('posts.kind missing — run Stage 14 SQL: ALTER TABLE posts ADD COLUMN kind text.'); hasKind = false; return true; } return false; } },
  { needle: 'visibility',       off: () => { if (hasVisibility)     { console.warn('posts.visibility missing — run Stage 16 SQL: ALTER TABLE posts ADD COLUMN visibility text DEFAULT \'public\'.'); hasVisibility = false; return true; } return false; } },
  { needle: 'close_friends',    off: () => { if (hasCloseFriends)   { console.warn('profiles.close_friends missing — run Stage 16 SQL.'); hasCloseFriends = false; return true; } return false; } },
  { needle: 'organization',     off: () => { if (hasOrganization)   { console.warn('profiles.organization missing — run Stage 16 SQL.'); hasOrganization = false; return true; } return false; } },
  { needle: 'repo_full_name',   off: () => { if (hasRepoFullName)   { console.warn('posts.repo_full_name missing — run Stage 30 SQL.'); hasRepoFullName = false; return true; } return false; } },
  { needle: 'event_url',        off: () => { if (hasEventUrl)       { console.warn('posts.event_url missing — run Stage 31 SQL.');     hasEventUrl     = false; return true; } return false; } },
];
function isMissingOptionalColumn(error) {
  const msg = String(error?.message || '').toLowerCase();
  if (!msg.includes('does not exist')) return false;
  // Two booleans: `matched` is whether the error CALLS OUT a known
  // optional column (retry-worthy), `flipped` is whether we actually
  // mutated a flag this call (persist-worthy). They diverge when a
  // concurrent query already flipped the same flag a moment ago — in
  // that case we still want to retry, because this caller's previous
  // round trip ran with the column in the SELECT list.
  let matched = false;
  let flipped = false;
  for (const o of OPTIONAL) {
    if (!msg.includes(o.needle)) continue;
    matched = true;
    if (o.off()) flipped = true;
  }
  if (flipped) persistSchemaCache();
  return matched;
}

function shapeAuthor(a) {
  if (!a) return null;
  const name = a.name || 'User';
  return {
    handle:      a.handle,
    name,
    avatar:      (name[0] || '?').toUpperCase(),
    avatarImage: a.avatar_url || null,
    avatarShape: a.avatar_shape || 'round',
  };
}

function shapePost(row) {
  const author = shapeAuthor(row.author);
  // Side-effect: cache the joined author so renderPost's sync getUser()
  // can find them on subsequent renders. ALWAYS merge — the previous
  // "skip if already cached" branch made another user's uploaded
  // avatar invisible to anyone whose cache was populated before the
  // upload, because the cache would never refresh.
  if (author?.handle) {
    const users = read(KEYS.users, {});
    users[author.handle] = {
      ...(users[author.handle] || {}),
      ...author,
      _fetched: Date.now(),
    };
    // Mutating the object read() returned updates the in-memory memo
    // immediately (so sync getUser() sees the author right away);
    // persisting is batched because shapePost runs once per fetched
    // row and stringifying the whole avatar-laden map per row was
    // measurable jank on mobile.
    scheduleUsersPersist();
  }
  return {
    id:            row.id,
    authorHandle:  author?.handle || '?',
    author,
    body:          row.body,
    githubLink:    row.github_link || undefined,
    spot:          row.spot || null,
    status:        row.status || 'wip',
    createdAt:     row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    // updated_at lands here when Postgres has a moddatetime / trigger on
    // posts; missing column → undefined → "not edited". The renderer
    // shows an "(編集済み)" pill only when editedAt > createdAt + 2s
    // (debounce against same-tx clock skew).
    editedAt:      row.updated_at ? new Date(row.updated_at).getTime() : null,
    // Composer-attached photos. Each entry is a data URL (JPEG) sized
    // to ~1080px by fileToPhotoDataUrl(). Missing when the photos
    // column isn't migrated yet → empty array, renderer skips silently.
    photos:        Array.isArray(row.photos) ? row.photos : [],
    // Composer-attached poll. Shape: { question, options[], deadlineAt,
    // createdAt }. Vote counts live in the separate poll_votes table —
    // counted on demand by the renderer so per-row jsonb writes don't
    // contend with each other. Null when no poll attached or column
    // not migrated yet.
    poll:          row.poll && typeof row.poll === 'object' ? row.poll : null,
    // Post kind tag. Currently 'idea', 'bug' or null (= regular note). Read
    // as a single source of truth so the composer toggle, the badge
    // renderer and any future "Ideas only" filter all agree.
    kind:          ['idea', 'bug'].includes(row.kind) ? row.kind : null,
    // Audience for the post. One of:
    //   'public' (default), 'mutuals', 'following', 'friends', 'org',
    //   or the legacy 'restricted' (= friends OR org).
    // RLS (Stage 18) does the actual gating server-side — by the time
    // this row arrives at the renderer it has already been allow-
    // listed for the current viewer.
    visibility:    (['public','mutuals','following','friends','org','restricted'].includes(row.visibility)
                      ? row.visibility : 'public'),
    quoteOfPostId: row.quote_of_post_id || null,
    // GitHub repo this post is "about", as owner/repo (Stage 30).
    // Used by /repos to group posts under each repository card.
    // Null when the column is missing or the post isn't tagged.
    repoFullName:  row.repo_full_name || null,
    // connpass event this post is "about" (Stage 31). Normalised
    // canonical form (https://connpass.com/event/<id>/), so a click
    // from any card goes to a consistent /event/<id> route.
    eventUrl:      row.event_url || null,
    actions: {
      replies:   row.comments_count   || 0,
      forks:     row.reposts_count    || 0,  // fork icon repurposed as リポスト
      stars:     row.bookmarks_count  || 0,  // star icon repurposed as 保存
      likes:     0,                          // hydrated from likes table
      quotes:    row.quotes_count     || 0,
    },
  };
}

// Insert a quote post. Behaves like addPost but stamps quote_of_post_id
// so the timeline can render the embedded quoted card. Silently degrades
// when Stage 11 isn't applied yet (drops the column from the insert).
export async function addQuote(post, quotedPostId) {
  const supa = await getClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) throw new Error('ログインしていません');
  const row = {
    author_id:   user.id,
    body:        post.body,
    github_link: post.githubLink || null,
    spot:        post.spot || null,
    status:      post.status || 'wip',
  };
  if (hasQuoteOf && quotedPostId) row.quote_of_post_id = quotedPostId;
  if (hasEventUrl && post.eventUrl) row.event_url = post.eventUrl;
  let res = await withResilientCols((cols) =>
    supa.from('posts').insert(row).select(cols).single()
  );
  if (res.error && /quote_of_post_id/i.test(res.error.message)) {
    // Schema doesn't have the column yet — fall back to a plain post.
    hasQuoteOf = false;
    delete row.quote_of_post_id;
    res = await withResilientCols((cols) =>
      supa.from('posts').insert(row).select(cols).single()
    );
  }
  if (res.error) throw new Error(res.error.message);
  return shapePost(res.data);
}

// Run `build(cols)` and keep retrying as long as the only error each
// time is a known-optional column. Postgres only reports the FIRST
// missing column per request, so a single retry isn't enough when
// several Stages are unmigrated — we have to loop, dropping one
// column per round trip, until the query either succeeds or hits a
// non-recoverable error. Capped at OPTIONAL.length + 1 so a buggy
// matcher can't spin forever.
async function withResilientCols(build) {
  let res = await build(postCols());
  for (let i = 0; i < OPTIONAL.length && res.error && isMissingOptionalColumn(res.error); i++) {
    res = await build(postCols());
  }
  return res;
}

// ----- timeline cache (instant-paint pattern) -----
//
// On the first visit the timeline blocks on a Supabase round trip
// (often 200-800ms on a cold cellular connection) and the page sits
// on the loading stub. On the second visit we want to paint the LAST
// known timeline immediately from localStorage so the user sees
// something the moment the JS executes, then silently swap in the
// fresh fetch when it lands.
//
// Cached blob is small (~5 KB / 20 posts) and gets clobbered every
// time `allPosts` succeeds. Versioned key so a future post shape
// change doesn't try to render an incompatible snapshot.

const POSTS_CACHE_KEY = 'spotcode:posts-cache:v1';
const POSTS_CACHE_MAX = 30;          // don't bloat localStorage
const POSTS_CACHE_TTL_MS = 6 * 3600 * 1000; // 6 hours

// In-memory mirror of the posts cache. Post photos are stored as
// 80–180KB base64 data URLs inside each row, so the serialized blob
// can reach several MB — JSON.parse-ing it on every render and
// re-stringifying the whole map on every fetch was the dominant CPU
// cost on mobile. The runtime now reads/writes this in-memory map
// only; localStorage receives a PHOTO-STRIPPED copy (so the next cold
// boot still paints text content instantly — photos pop in when the
// live fetch lands). In-session repaints keep full photos because
// they read the memory copy.
let postsCacheMem = null;
function postsCacheAll() {
  if (postsCacheMem) return postsCacheMem;
  try { postsCacheMem = JSON.parse(localStorage.getItem(POSTS_CACHE_KEY) || '{}'); }
  catch { postsCacheMem = {}; }
  if (!postsCacheMem || typeof postsCacheMem !== 'object') postsCacheMem = {};
  return postsCacheMem;
}
function persistPostsCache(all) {
  try {
    const slim = {};
    for (const scope of Object.keys(all)) {
      const e = all[scope];
      if (!e || !Array.isArray(e.posts)) continue;
      slim[scope] = {
        at: e.at,
        // photosStripped marks the row as an incomplete snapshot so
        // freshness-based fetch-skipping (hydrateHome) never treats a
        // photo-less cold-boot cache as the real thing.
        posts: e.posts.map((p) =>
          (p && Array.isArray(p.photos) && p.photos.length)
            ? { ...p, photos: [], photosStripped: true }
            : p
        ),
      };
    }
    localStorage.setItem(POSTS_CACHE_KEY, JSON.stringify(slim));
  } catch {}
}

function savePostsCache(scope, posts) {
  const all = postsCacheAll();
  all[scope] = {
    at: Date.now(),
    posts: posts.slice(0, POSTS_CACHE_MAX),
  };
  persistPostsCache(all);
}

// Module-level map of just-inserted post id → shaped post, kept in
// memory so the fetchers below can merge them back in when they
// race the Postgres read-replica. addPost() registers each new row
// here right after Supabase confirms the INSERT; the entry self-
// expires after `OPTIMISTIC_TTL_MS` so a row that was eventually
// reflected in a fetch stops being injected forever.
//
// Without this, the sequence:
//   addPost → refresh() → hydrateHome fetches from a replica that
//   hasn't seen the insert yet → list rebuilds WITHOUT the new row
// made the user think their post didn't go through. Localstorage
// prepend alone couldn't fix it because `savePostsCache` overwrites
// the cache with whatever the fetch returned a moment later.
const OPTIMISTIC_TTL_MS = 60 * 1000;
const optimisticPosts = new Map();   // id → { at, post }

// Pre-emptive delete tombstone. The click handler in main.js marks an
// id here BEFORE awaiting Supabase, so any render that fires during
// the round-trip (e.g. an onAuthChange refresh, a navigation) hides
// the post immediately. Confirmed-delete promotes the id to the
// `removeFromTimelineCaches` path which wipes the persistent cache;
// failed-delete unmarks it so the next render restores the post.
const pendingDeletes = new Set();   // post ids

function optimisticPostsForScope(scope) {
  const now = Date.now();
  const out = [];
  for (const [id, entry] of optimisticPosts) {
    if (now - entry.at > OPTIMISTIC_TTL_MS) { optimisticPosts.delete(id); continue; }
    const p = entry.post;
    if (scope === 'home') out.push(p);
    else if (scope.startsWith('handle:') && ('handle:' + p.authorHandle) === scope) out.push(p);
    else if (scope.startsWith('city:')) {
      const city = p.spot && p.spot.addressDetails && p.spot.addressDetails.city;
      if (city && ('city:' + city) === scope) out.push(p);
    }
    else if (scope === 'following') out.push(p); // overlay's brand follows itself; harmless either way
    else if (scope === 'github-refs') {
      // The /repos lookup wants every post with either an explicit
      // repo tag OR a parseable github_link — let either through.
      if (p.repoFullName || p.githubLink) out.push(p);
    }
  }
  return out;
}

// Merge optimistic posts into a freshly-fetched array. Any id that
// the fetch already returned wins (the server-side row is the truth
// once it's visible). Dedupe + re-sort newest-first. Posts currently
// in `pendingDeletes` are filtered out so an in-flight delete doesn't
// flash the row back into the timeline on a concurrent fetch.
function mergeOptimistic(fetched, scope) {
  const live = pendingDeletes.size
    ? fetched.filter((p) => !pendingDeletes.has(p.id))
    : fetched;
  const opt = optimisticPostsForScope(scope);
  if (!opt.length) return live;
  const liveIds = new Set(live.map((p) => p.id));
  // If the fetch confirmed an optimistic entry, drop it from the
  // map — replica caught up; no further injection needed.
  for (const p of opt) {
    if (liveIds.has(p.id)) optimisticPosts.delete(p.id);
  }
  const stillOpt = opt.filter((p) => !liveIds.has(p.id) && !pendingDeletes.has(p.id));
  if (!stillOpt.length) return live;
  return [...stillOpt, ...live]
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// Optimistically prepend a freshly-inserted post into every
// localStorage timeline scope it could plausibly appear in (so the
// next renderXxx() paints with the new row), AND register it in the
// in-memory optimisticPosts map (so the next fetch's overwrite
// merges it back in if the read replica still hasn't seen it).
//
// Followers' "Following" feeds aren't seeded into localStorage:
// only the auth user would benefit, and they almost never appear in
// their own following list. The optimisticPosts map does inject
// into 'following' though — harmless if the user doesn't follow
// themselves, and correct if they (or their overlay identity) do.
export function prependToTimelineCaches(post) {
  if (!post || !post.id) return;
  optimisticPosts.set(post.id, { at: Date.now(), post });
  const scopes = ['home'];
  if (post.authorHandle && post.authorHandle !== '?') {
    scopes.push('handle:' + post.authorHandle);
  }
  const city = post.spot && post.spot.addressDetails && post.spot.addressDetails.city;
  if (city) scopes.push('city:' + city);
  const all = postsCacheAll();
  for (const scope of scopes) {
    const e = all[scope];
    const prev = (e && Array.isArray(e.posts)) ? e.posts : [];
    // Dedupe by id — addPost re-running (e.g. on a retry) would
    // otherwise queue the same row twice.
    const next = [post, ...prev.filter((p) => p.id !== post.id)]
      .slice(0, POSTS_CACHE_MAX);
    all[scope] = { at: Date.now(), posts: next };
  }
  persistPostsCache(all);
}

// Returns the cached posts array (already in the same shape as
// shapePost output — they were saved post-shape), or null if no entry
// for this scope or the entry is older than TTL. In-flight deletes
// are filtered out here too so a navigation-triggered re-render
// during the round-trip doesn't paint a row the user just removed.
// `maxAgeMs` lets a caller ask for a stricter freshness bound than the
// default paint TTL — e.g. hydrateHome treats a <60s-old cache as
// "fresh enough to skip the refetch entirely".
export function cachedPosts(scope, maxAgeMs = POSTS_CACHE_TTL_MS) {
  try {
    const e = postsCacheAll()[scope];
    if (!e || !e.posts) return null;
    if (Date.now() - (e.at || 0) > maxAgeMs) return null;
    return pendingDeletes.size
      ? e.posts.filter((p) => !pendingDeletes.has(p.id))
      : e.posts;
  } catch { return null; }
}

// Boot-time schema probe. Runs once on first read after the page
// loads (or never, if the localStorage flags are already cached).
// Fires a single 1-row select with the full column set; the error
// message disables every missing optional in one round-trip pass.
// Subsequent queries skip the per-request retry loop entirely.
// Also probes the Stage 11 optional tables (reposts / bookmarks) via
// interactions.js so visible-post batches never see a 404 either.
let probeDone = false;
let probePromise = null;
export function probeSchema() {
  if (probeDone) return Promise.resolve();
  if (probePromise) return probePromise;
  probePromise = (async () => {
    try {
      const supa = await getClient();
      // Optimistic reset: a cached `false` flag could be stale (e.g.
      // user hit a missing-column error before the admin ran the
      // migration). Flip every flag back to true before the probe so
      // the first round trip actually verifies the live schema. If a
      // column really doesn't exist, the retry loop below catches it
      // and re-flips — same end state as before, but newly-migrated
      // columns become visible without waiting for the TTL.
      hasCommentsCount = hasRepostsCount = hasBookmarksCount = true;
      hasQuotesCount = hasQuoteOf = hasPhotos = hasPoll = hasKind = true;
      hasVisibility = hasCloseFriends = hasOrganization = true;
      let dirty = false;
      // Posts column probe — retry-loop drops one missing column per
      // round trip until the select succeeds or no more flags can flip.
      for (let i = 0; i <= OPTIONAL.length; i++) {
        const { error } = await supa.from('posts').select(postCols()).limit(1);
        if (!error) break;
        if (!isMissingOptionalColumn(error)) break;
        dirty = true;
      }
      // If the probe ended with all flags intact (success on the first
      // try), persist that so a previously-cached `false` from before
      // the migration doesn't keep getting re-loaded.
      if (!dirty) persistSchemaCache();
    } catch {}
    // Parallel probe of optional tables. Dynamic import avoids a
    // circular dep between data.js ↔ interactions.js at module load.
    try {
      const { probeOptionalTables } = await import('./interactions.js');
      await probeOptionalTables();
    } catch {}
    probeDone = true;
    probePromise = null;
  })();
  return probePromise;
}

// Fetch a single post by id (for /post/<id>). Returns null on 404 or RLS
// miss so the view can render its own not-found state.
export async function getPost(id) {
  if (!id) return null;
  const supa = await getClient();
  const { data, error } = await withResilientCols((cols) =>
    supa.from('posts').select(cols).eq('id', id).maybeSingle()
  );
  if (error) { console.warn('getPost', error); return null; }
  return data ? shapePost(data) : null;
}

export async function allPosts({ limit = 100 } = {}) {
  const supa = await getClient();
  const { data, error } = await withResilientCols((cols) =>
    supa.from('posts').select(cols)
      .order('created_at', { ascending: false })
      .limit(limit)
  );
  if (error) throw new Error(error.message);
  const shaped = mergeOptimistic((data || []).map(shapePost), 'home');
  savePostsCache('home', shaped);
  return shaped;
}

// Posts with a spot attached, for the /spots map. Filters
// server-side via `spot is not null` so we don't transfer the ~90%
// of posts that have no location — the biggest single win for
// "/spots feels heavy". Same shape as allPosts otherwise.
export async function postsWithSpots({ limit = 200 } = {}) {
  const supa = await getClient();
  const { data, error } = await withResilientCols((cols) =>
    supa.from('posts').select(cols)
      .not('spot', 'is', null)
      .order('created_at', { ascending: false })
      .limit(limit)
  );
  if (error) throw new Error(error.message);
  const shaped = mergeOptimistic((data || []).map(shapePost), 'spots');
  savePostsCache('spots', shaped);
  return shaped;
}

// Posts authored by anyone the current user accepted-follows, newest
// first. Returns [] when not logged in or when the user follows no
// one (the view shows a "follow someone" empty state in that case).
export async function followingPosts({ limit = 100 } = {}) {
  const supa = await getClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return [];
  const { data: follows, error: fErr } = await supa
    .from('follows').select('target_id')
    .eq('follower_id', user.id)
    .eq('status', 'accepted');
  if (fErr) throw new Error(fErr.message);
  const targetIds = (follows || []).map(r => r.target_id);
  if (!targetIds.length) return [];
  const { data, error } = await withResilientCols((cols) =>
    supa.from('posts').select(cols)
      .in('author_id', targetIds)
      .order('created_at', { ascending: false })
      .limit(limit)
  );
  if (error) throw new Error(error.message);
  const shaped = mergeOptimistic((data || []).map(shapePost), 'following');
  savePostsCache('following', shaped);
  return shaped;
}

export async function postsByHandle(handle) {
  if (!handle) return [];
  const supa = await getClient();
  // Fast path: if a previous call (or the profile-view boot flow) has
  // already resolved handle → id, skip the extra Supabase round trip.
  // Cuts the wall-clock in half on slow networks — where two serial
  // queries were pushing past the 15s timeout.
  let userId = cachedHandleId(handle);
  if (!userId) {
    const { data: prof, error: profErr } = await supa
      .from('profiles')
      .select('id')
      .eq('handle', handle)
      .maybeSingle();
    if (profErr) throw new Error(profErr.message);
    if (!prof) return [];
    userId = prof.id;
    cacheHandleId(handle, userId);
  }
  const { data, error } = await withResilientCols((cols) =>
    supa.from('posts').select(cols)
      .eq('author_id', userId)
      .order('created_at', { ascending: false })
  );
  if (error) throw new Error(error.message);
  const shaped = mergeOptimistic((data || []).map(shapePost), 'handle:' + handle);
  savePostsCache('handle:' + handle, shaped);
  return shaped;
}

// Posts liked by a given handle (for the profile "Likes" tab).
export async function likedPostsByHandle(handle) {
  if (!handle) return [];
  const supa = await getClient();
  let userId = cachedHandleId(handle);
  if (!userId) {
    const { data: prof, error: profErr } = await supa
      .from('profiles')
      .select('id')
      .eq('handle', handle)
      .maybeSingle();
    if (profErr) throw new Error(profErr.message);
    if (!prof) return [];
    userId = prof.id;
    cacheHandleId(handle, userId);
  }
  // Embed the full post (with its author) under each like row. The FK
  // name hint is required for the same reason postCols() already pins
  // posts→profiles.
  const { data, error } = await withResilientCols((cols) =>
    supa.from('likes')
      .select('created_at, post:posts!likes_post_id_fkey(' + cols + ')')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
  );
  if (error) throw new Error(error.message);
  return (data || [])
    .map(r => r.post)
    .filter(Boolean)
    .map(shapePost);
}

// Every post tagged with the given connpass event URL. The
// stored event_url is normalised to https://connpass.com/event/<id>/
// on insert, so we match by exact string. Falls back to `.ilike`
// with the id fragment if the exact form varies (older rows saved
// without the trailing slash).
export async function postsByEventId(eventId) {
  if (!eventId) return [];
  if (!hasEventUrl) return [];  // schema not migrated yet
  const supa = await getClient();
  const canonical = 'https://connpass.com/event/' + eventId + '/';
  const { data, error } = await withResilientCols((cols) =>
    supa.from('posts').select(cols)
      .or('event_url.eq.' + canonical +
          ',event_url.ilike.%/event/' + eventId + '/%')
      .order('created_at', { ascending: false })
  );
  if (error) {
    if (/event_url/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  const shaped = mergeOptimistic((data || []).map(shapePost), 'event:' + eventId);
  savePostsCache('event:' + eventId, shaped);
  return shaped;
}

export async function postsByCity(city) {
  if (!city) return [];
  const supa = await getClient();
  // PostgREST JSONB path filter: spot->addressDetails->>city == city.
  // The post.spot column is jsonb and addressDetails is the nested
  // object we save from the picker.
  const { data, error } = await withResilientCols((cols) =>
    supa.from('posts').select(cols)
      .eq('spot->addressDetails->>city', city)
      .order('created_at', { ascending: false })
  );
  if (error) throw new Error(error.message);
  const shaped = mergeOptimistic((data || []).map(shapePost), 'city:' + city);
  savePostsCache('city:' + city, shaped);
  return shaped;
}

// Every post that references a GitHub repo — either explicitly via
// the Stage 30 `repo_full_name` column, or implicitly via a
// `github_link` URL we can parse owner/repo out of. Returned in one
// round trip so the /repos view can build its `fullName → posts[]`
// map client-side instead of N queries (one per repo card).
//
// Why this also reads github_link: every post in the wild today has
// no repo_full_name (the tagging UI ships in a follow-up), but many
// already paste a github.com/owner/repo URL into the link field.
// Without this synthetic fallback /repos would show empty forever
// despite real activity.
//
// Filter is server-side: PostgREST `or()` matches rows where EITHER
// column is non-null, so the table-scan cost stays bounded even on a
// large posts table.
export async function postsWithGithubRefs({ limit = 200 } = {}) {
  const supa = await getClient();
  // Only one branch of the OR can use repo_full_name when the column
  // hasn't been migrated yet — drop it from the predicate in that
  // case so the request doesn't 400.
  const filter = hasRepoFullName
    ? 'repo_full_name.not.is.null,github_link.not.is.null'
    : 'github_link.not.is.null';
  const { data, error } = await withResilientCols((cols) =>
    supa.from('posts').select(cols)
      .or(filter)
      .order('created_at', { ascending: false })
      .limit(limit)
  );
  if (error) {
    // Schema mismatch → return empty rather than throwing; the /repos
    // view already degrades to "GitHub data only" in that case.
    if (/repo_full_name|github_link/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return mergeOptimistic((data || []).map(shapePost), 'github-refs');
}

// Fetch + attach the quoted post for any visible post with quoteOfPostId
// set. Mutates each post in place by adding `p.quoteOf` (or leaving it
// null when the quoted post is gone / RLS-blocked / Stage 11 missing).
// Bulk-queried in one round trip per page; safe to call on empty/all-
// non-quote arrays.
export async function hydrateQuotedPosts(posts) {
  if (!posts || !posts.length) return;
  const ids = [...new Set(posts.map(p => p.quoteOfPostId).filter(Boolean))];
  if (!ids.length) return;
  let supa; try { supa = await getClient(); } catch { return; }
  const { data, error } = await withResilientCols((cols) =>
    supa.from('posts').select(cols).in('id', ids)
  );
  if (error) { console.warn('hydrateQuotedPosts', error); return; }
  const byId = new Map();
  for (const row of (data || [])) byId.set(row.id, shapePost(row));
  for (const p of posts) {
    if (p.quoteOfPostId) p.quoteOf = byId.get(p.quoteOfPostId) || null;
  }
}

const PHOTOS_MIGRATION_MSG =
  '写真機能のマイグレーションが未実行です。Supabase で次の SQL を一度だけ実行してください: ' +
  'ALTER TABLE posts ADD COLUMN IF NOT EXISTS photos jsonb DEFAULT \'[]\'::jsonb;';
const POLL_MIGRATION_MSG =
  '投票機能のマイグレーションが未実行です。Supabase で次の SQL を一度だけ実行してください: ' +
  'ALTER TABLE posts ADD COLUMN IF NOT EXISTS poll jsonb; ' +
  'CREATE TABLE IF NOT EXISTS poll_votes (post_id uuid REFERENCES posts(id) ON DELETE CASCADE, ' +
  'user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE, option_idx int NOT NULL, ' +
  'created_at timestamptz DEFAULT now(), PRIMARY KEY (post_id, user_id));';

export async function addPost(post) {
  const supa = await getClient();
  // currentUser() was established from the active Supabase session during
  // auth boot/login. Do not call auth.getUser() again here: that performs a
  // network round trip before every insert and can hang behind GoTrue's token
  // refresh lock, making Push appear broken until a reload. PostgREST still
  // validates the JWT and RLS server-side, so this does not weaken auth.
  const me = currentUser();
  if (!me?.id) throw new Error('ログイン情報を確認できません。もう一度ログインしてください');
  const wantsPhotos = Array.isArray(post.photos) && post.photos.length > 0;
  const wantsPoll = post.poll && Array.isArray(post.poll.options) && post.poll.options.length >= 2;

  // "Posting as official" overlay (admin/op only). The user's
  // Supabase session is unchanged — Stage 25 RLS validates that
  // admin/op privileges are present before letting the substituted
  // author_id through.
  let authorId = me.id;
  if (isPostingAsOfficial()) {
    const official = await getOfficialAccount();
    if (!official) throw new Error('公式アカウントが設定されていません (Stage 25 マイグレーション未実行?)');
    authorId = official.id;
  }

  const row = {
    author_id:   authorId,
    body:        post.body,
    github_link: post.githubLink || null,
    spot:        post.spot || null,
    status:      post.status || 'wip',
  };
  if (wantsPhotos) row.photos = post.photos;
  if (['idea', 'bug'].includes(post.kind) && hasKind) row.kind = post.kind;
  if (hasEventUrl && post.eventUrl) row.event_url = post.eventUrl;
  if (typeof post.visibility === 'string' &&
      ['mutuals','following','friends','org','restricted'].includes(post.visibility)) {
    row.visibility = post.visibility;
    hasVisibility = true;
  }
  if (wantsPoll) {
    // Stamp createdAt on the poll for ordering on the renderer.
    row.poll = {
      question:   post.poll.question,
      options:    post.poll.options,
      deadlineAt: post.poll.deadlineAt,
      createdAt:  Date.now(),
    };
  }

  // When photos OR poll are attached: optimistically try with the
  // columns in place. If Postgres rejects with one of them missing,
  // surface a clear migration message — do NOT fall through to the
  // silent retry path, because that would post a text-only row and the
  // user would think their attachment vanished. Other optional columns
  // (counts etc.) can still degrade through the resilient SELECT pass.
  if (wantsPhotos || wantsPoll) {
    if (wantsPhotos) hasPhotos = true;
    if (wantsPoll)   hasPoll   = true;
    const { data, error } = await supa.from('posts').insert(row).select(postCols()).single();
    if (error) {
      const msg = String(error.message || '').toLowerCase();
      if (wantsPhotos && msg.includes('photos') && msg.includes('does not exist')) {
        isMissingOptionalColumn(error);
        throw new Error(PHOTOS_MIGRATION_MSG);
      }
      if (wantsPoll && msg.includes('poll') && msg.includes('does not exist')) {
        isMissingOptionalColumn(error);
        throw new Error(POLL_MIGRATION_MSG);
      }
      throw new Error(error.message);
    }
    return shapePost(data);
  }

  // No photos: use the resilient path so other optional Stages can
  // degrade silently as before.
  const { data, error } = await withResilientCols((cols) =>
    supa.from('posts').insert(row).select(cols).single()
  );
  if (error) throw new Error(error.message);
  return shapePost(data);
}

// Edit an existing post — currently just the body, since that's what
// the inline editor exposes. `.select()` forces PostgREST to return the
// updated row so an RLS reject (not author / not dev with admin SQL)
// surfaces as an empty array instead of looking like success.
export async function updatePost(postId, fields) {
  const supa = await getClient();
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(fields, 'visibility')) {
    if (!['public', 'mutuals', 'following', 'friends', 'org', 'restricted'].includes(fields.visibility)) {
      throw new Error('表示先が正しくありません');
    }
    // Never omit an explicitly selected audience because of a stale schema cache.
    patch.visibility = fields.visibility;
    hasVisibility = true;
  }
  if (typeof fields.body === 'string') patch.body = fields.body;
  // `kind` accepts 'idea' or 'bug' to tag, or null to untag.
  if (['idea', 'bug'].includes(fields.kind) || fields.kind === null) {
    if (hasKind) patch.kind = fields.kind;
  }
  // `githubLink` is always optional — undefined means "leave alone",
  // empty string / null means "clear it". Saved as posts.github_link
  // (NOT a Stage 30 column, present in the base schema since v0).
  if (Object.prototype.hasOwnProperty.call(fields, 'githubLink')) {
    const v = fields.githubLink;
    patch.github_link = (v && String(v).trim()) || null;
  }
  if (hasRepoFullName && Object.prototype.hasOwnProperty.call(fields, 'repoFullName')) {
    const value = fields.repoFullName;
    patch.repo_full_name = (value && String(value).trim()) || null;
  }
  // `eventUrl` — same optional shape as githubLink. Only writes when
  // the column exists (Stage 31 migration applied).
  if (hasEventUrl && Object.prototype.hasOwnProperty.call(fields, 'eventUrl')) {
    const v = fields.eventUrl;
    patch.event_url = (v && String(v).trim()) || null;
  }
  if (!Object.keys(patch).length) return null;
  const { data, error } = await withResilientCols((cols) =>
    supa.from('posts').update(patch).eq('id', postId).select(cols)
  );
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error('編集権限がありません（RLS により拒否）');
  }
  const updated = shapePost(data[0]);
  // Evict old audience/body snapshots so navigation cannot restore stale metadata.
  removeFromTimelineCaches(postId);
  return updated;
}

export async function removePost(postId) {
  const supa = await getClient();
  // .select() forces PostgREST to return the deleted row(s). Without it,
  // RLS silently dropping the operation looks like success to the caller.
  const { data, error } = await supa
    .from('posts').delete().eq('id', postId).select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    // Empty result usually means the moderator delete policy isn't
    // installed yet (Stage 15). Mention it so dev users know what to
    // run — own-post deletes hit a different policy and don't end up
    // here.
    throw new Error(
      '削除権限がありません。他ユーザーの投稿を消すには Stage 15 SQL を実行してください: ' +
      'ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false; ' +
      'UPDATE profiles SET is_admin = true WHERE handle IN (\'hrmcngs\'); ' +
      'CREATE POLICY "admins can delete any post" ON posts FOR DELETE ' +
      'USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));'
    );
  }
  // Confirmed delete: wipe the row from every persistent cache scope
  // and the in-memory optimistic map so a later renderXxx never
  // re-paints it from a stale snapshot.
  removeFromTimelineCaches(postId);
  return true;
}

// Mark a post id as in-flight delete. Filtered out by `cachedPosts`
// and `mergeOptimistic` until either `removeFromTimelineCaches`
// (success, persistent prune) or `unmarkPendingDelete` (failure,
// restore) clears it.
export function markPendingDelete(id) {
  if (id) pendingDeletes.add(String(id));
}
export function unmarkPendingDelete(id) {
  pendingDeletes.delete(String(id));
}

// Persistent prune: drop the row from every timeline scope in
// localStorage + the in-memory optimisticPosts map + the
// pendingDeletes tombstone (no longer "pending", actually gone).
// Idempotent — safe to call multiple times for the same id.
export function removeFromTimelineCaches(id) {
  if (!id) return;
  const key = String(id);
  pendingDeletes.delete(key);
  optimisticPosts.delete(key);
  const all = postsCacheAll();
  let dirty = false;
  for (const scope of Object.keys(all)) {
    const e = all[scope];
    if (!e || !Array.isArray(e.posts)) continue;
    const before = e.posts.length;
    e.posts = e.posts.filter((p) => p.id !== key);
    if (e.posts.length !== before) dirty = true;
  }
  if (dirty) persistPostsCache(all);
}

// ----------------------------------------------------------------------
// POLL VOTES — separate table so per-row jsonb writes don't contend.
// ----------------------------------------------------------------------

// Per-poll tally: returns { counts: [n, n, …], total, myChoice|null }.
// `myChoice` is the option index the current user voted for, or null
// when they haven't voted (also for guests).
export async function pollTally(postId) {
  if (!postId) return { counts: [], total: 0, myChoice: null };
  const supa = await getClient();
  const { data: { user } } = await supa.auth.getUser();
  const { data, error } = await supa
    .from('poll_votes').select('option_idx, user_id').eq('post_id', postId);
  if (error) {
    // Table not migrated yet → return empty tally so the renderer
    // still shows the question + options, just without bars.
    return { counts: [], total: 0, myChoice: null };
  }
  const rows = data || [];
  const counts = [];
  let myChoice = null;
  for (const r of rows) {
    const k = Number(r.option_idx);
    counts[k] = (counts[k] || 0) + 1;
    if (user && r.user_id === user.id) myChoice = k;
  }
  return { counts, total: rows.length, myChoice };
}

// Cast / change a vote. One row per (post, user) enforced by the
// primary key in the migration; we UPSERT so re-voting overwrites.
export async function votePoll(postId, optionIdx) {
  if (!postId) throw new Error('NO_POST');
  const supa = await getClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) throw new Error('ログインしていません');
  const { error } = await supa.from('poll_votes')
    .upsert({ post_id: postId, user_id: user.id, option_idx: optionIdx },
            { onConflict: 'post_id,user_id' });
  if (error) {
    const msg = String(error.message || '').toLowerCase();
    if (msg.includes('poll_votes') && (msg.includes('does not exist') || msg.includes('not found'))) {
      throw new Error(POLL_MIGRATION_MSG);
    }
    throw new Error(error.message);
  }
  return true;
}

// Relative-time formatter ("just now", "5m", "3h", "2d").
export function relTime(ts) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60)       return s + 's';
  if (s < 3600)     return Math.floor(s / 60) + 'm';
  if (s < 86400)    return Math.floor(s / 3600) + 'h';
  if (s < 86400*7)  return Math.floor(s / 86400) + 'd';
  const d = new Date(ts);
  return d.getMonth() + 1 + '/' + d.getDate();
}
