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
  } catch {}
})();
function persistSchemaCache() {
  try {
    localStorage.setItem(SCHEMA_CACHE_KEY, JSON.stringify({
      at: Date.now(),
      hasCommentsCount, hasRepostsCount, hasBookmarksCount, hasQuotesCount, hasQuoteOf, hasPhotos, hasPoll, hasKind,
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
  const head =
    'id, body, github_link, spot, status, created_at' +
    (extras.length ? ', ' + extras.join(', ') : '');
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
    write(KEYS.users, users);
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
    // Post kind tag. Currently 'idea' or null (= regular note). Read
    // as a single source of truth so the composer toggle, the badge
    // renderer and any future "Ideas only" filter all agree.
    kind:          row.kind === 'idea' ? 'idea' : null,
    quoteOfPostId: row.quote_of_post_id || null,
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

function savePostsCache(scope, posts) {
  try {
    const all = JSON.parse(localStorage.getItem(POSTS_CACHE_KEY) || '{}');
    all[scope] = {
      at: Date.now(),
      posts: posts.slice(0, POSTS_CACHE_MAX),
    };
    localStorage.setItem(POSTS_CACHE_KEY, JSON.stringify(all));
  } catch {}
}

// Returns the cached posts array (already in the same shape as
// shapePost output — they were saved post-shape), or null if no entry
// for this scope or the entry is older than TTL.
export function cachedPosts(scope) {
  try {
    const all = JSON.parse(localStorage.getItem(POSTS_CACHE_KEY) || '{}');
    const e = all[scope];
    if (!e || !e.posts) return null;
    if (Date.now() - (e.at || 0) > POSTS_CACHE_TTL_MS) return null;
    return e.posts;
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
  const shaped = (data || []).map(shapePost);
  savePostsCache('home', shaped);
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
  const shaped = (data || []).map(shapePost);
  savePostsCache('following', shaped);
  return shaped;
}

export async function postsByHandle(handle) {
  if (!handle) return [];
  const supa = await getClient();
  const { data: prof, error: profErr } = await supa
    .from('profiles')
    .select('id')
    .eq('handle', handle)
    .maybeSingle();
  if (profErr) throw new Error(profErr.message);
  if (!prof) return [];
  const { data, error } = await withResilientCols((cols) =>
    supa.from('posts').select(cols)
      .eq('author_id', prof.id)
      .order('created_at', { ascending: false })
  );
  if (error) throw new Error(error.message);
  const shaped = (data || []).map(shapePost);
  savePostsCache('handle:' + handle, shaped);
  return shaped;
}

// Posts liked by a given handle (for the profile "Likes" tab).
export async function likedPostsByHandle(handle) {
  if (!handle) return [];
  const supa = await getClient();
  const { data: prof, error: profErr } = await supa
    .from('profiles')
    .select('id')
    .eq('handle', handle)
    .maybeSingle();
  if (profErr) throw new Error(profErr.message);
  if (!prof) return [];
  // Embed the full post (with its author) under each like row. The FK
  // name hint is required for the same reason postCols() already pins
  // posts→profiles.
  const { data, error } = await withResilientCols((cols) =>
    supa.from('likes')
      .select('created_at, post:posts!likes_post_id_fkey(' + cols + ')')
      .eq('user_id', prof.id)
      .order('created_at', { ascending: false })
  );
  if (error) throw new Error(error.message);
  return (data || [])
    .map(r => r.post)
    .filter(Boolean)
    .map(shapePost);
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
  const shaped = (data || []).map(shapePost);
  savePostsCache('city:' + city, shaped);
  return shaped;
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
  const { data: { user } } = await supa.auth.getUser();
  if (!user) throw new Error('ログインしていません');
  const wantsPhotos = Array.isArray(post.photos) && post.photos.length > 0;
  const wantsPoll = post.poll && Array.isArray(post.poll.options) && post.poll.options.length >= 2;

  const row = {
    author_id:   user.id,
    body:        post.body,
    github_link: post.githubLink || null,
    spot:        post.spot || null,
    status:      post.status || 'wip',
  };
  if (wantsPhotos) row.photos = post.photos;
  if (post.kind === 'idea' && hasKind) row.kind = 'idea';
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
  if (typeof fields.body === 'string') patch.body = fields.body;
  // `kind` accepts the string 'idea' to tag, or null to untag.
  if (fields.kind === 'idea' || fields.kind === null) {
    if (hasKind) patch.kind = fields.kind;
  }
  if (!Object.keys(patch).length) return null;
  const { data, error } = await withResilientCols((cols) =>
    supa.from('posts').update(patch).eq('id', postId).select(cols)
  );
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error('編集権限がありません（RLS により拒否）');
  }
  return shapePost(data[0]);
}

export async function removePost(postId) {
  const supa = await getClient();
  // .select() forces PostgREST to return the deleted row(s). Without it,
  // RLS silently dropping the operation looks like success to the caller.
  const { data, error } = await supa
    .from('posts').delete().eq('id', postId).select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error('削除権限がありません（RLS により拒否、または既に削除済み）');
  }
  return true;
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
