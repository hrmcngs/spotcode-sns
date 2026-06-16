// Likes / follows / reports backed by Supabase (Stage 5).
//
// Reads are served from small in-memory caches populated by `hydrate*()`
// helpers, so the existing sync getters (`likeCount(postId)` etc) keep
// the render path simple. Writes are async and update the cache
// optimistically before the round trip.

import { getClient } from './supa.js';

// post id  -> { count, mine }
const likes = new Map();
// post id -> { mine } — Stage 11
const reposts   = new Map();
const bookmarks = new Map();
// user handle -> { followers, following }
const followCounts = new Map();
// target handles that the current session user follows (status='accepted')
const followsMine = new Set();
// target handles where the current session user has a pending request
const requestsMine = new Set();
let followsMineLoaded = false;

export function clearInteractionsCache() {
  likes.clear();
  followCounts.clear();
  followsMine.clear();
  requestsMine.clear();
  followsMineLoaded = false;
  reposts.clear();
  bookmarks.clear();
}

// ----------------------------------------------------------------------
// LIKES
// ----------------------------------------------------------------------

export function likeCount(postId) {
  return likes.get(postId)?.count || 0;
}
export function isLiked(postId /* , _handle ignored */) {
  return !!likes.get(postId)?.mine;
}

// Batch-fetch like counts + isLiked-by-me for the visible post IDs in
// two round trips (one for everyone's rows, one for mine).
export async function hydratePostLikes(postIds) {
  if (!postIds || !postIds.length) return;
  let supa; try { supa = await getClient(); } catch { return; }

  const { data: { user } } = await supa.auth.getUser();
  const { data: rows } = await supa
    .from('likes')
    .select('post_id, user_id')
    .in('post_id', postIds);

  const counts = new Map();
  const mine   = new Set();
  for (const r of rows || []) {
    counts.set(r.post_id, (counts.get(r.post_id) || 0) + 1);
    if (user && r.user_id === user.id) mine.add(r.post_id);
  }
  for (const id of postIds) {
    likes.set(id, { count: counts.get(id) || 0, mine: mine.has(id) });
  }
}

export async function toggleLike(postId /* , _handle ignored */) {
  const supa = await getClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) throw new Error('ログインしてください');
  const state = likes.get(postId) || { count: 0, mine: false };
  if (state.mine) {
    const { error } = await supa.from('likes')
      .delete().eq('post_id', postId).eq('user_id', user.id);
    if (error) throw new Error(error.message);
    likes.set(postId, { count: Math.max(0, state.count - 1), mine: false });
  } else {
    const { error } = await supa.from('likes')
      .insert({ post_id: postId, user_id: user.id });
    if (error) throw new Error(error.message);
    likes.set(postId, { count: state.count + 1, mine: true });
  }
  return likes.get(postId).mine;
}

// ----------------------------------------------------------------------
// FOLLOWS
// ----------------------------------------------------------------------

export function followerCount(handle)  { return followCounts.get(handle)?.followers  || 0; }
export function followingCount(handle) { return followCounts.get(handle)?.following || 0; }
export function isFollowing(_myHandle, targetHandle) { return followsMine.has(targetHandle); }
export function isRequested(_myHandle, targetHandle) { return requestsMine.has(targetHandle); }

async function userIdFromHandle(handle) {
  const supa = await getClient();
  const { data } = await supa.from('profiles').select('id').eq('handle', handle).maybeSingle();
  return data?.id || null;
}

async function userMetaByHandle(handle) {
  const supa = await getClient();
  const { data } = await supa.from('profiles').select('id, is_private').eq('handle', handle).maybeSingle();
  return data || null;
}

// One round trip per session to know which handles the current user
// follows (accepted) vs has a pending request for. Used by the sync
// `isFollowing()` / `isRequested()` getters.
export async function hydrateMyFollows() {
  if (followsMineLoaded) return;
  let supa; try { supa = await getClient(); } catch { return; }
  const { data: { user } } = await supa.auth.getUser();
  if (!user) { followsMineLoaded = true; return; }
  const { data } = await supa
    .from('follows')
    .select('status, target:profiles!follows_target_id_fkey(handle)')
    .eq('follower_id', user.id);
  followsMine.clear();
  requestsMine.clear();
  for (const r of data || []) {
    const h = r.target?.handle;
    if (!h) continue;
    if (r.status === 'pending') requestsMine.add(h);
    else                        followsMine.add(h);
  }
  followsMineLoaded = true;
}

// Fill followCounts for a single user (used by profile page).
export async function hydrateProfileFollow(handle) {
  let supa; try { supa = await getClient(); } catch { return; }
  const id = await userIdFromHandle(handle);
  if (!id) return;
  const [followers, following] = await Promise.all([
    supa.from('follows').select('*', { count: 'exact', head: true })
      .eq('target_id', id).eq('status', 'accepted'),
    supa.from('follows').select('*', { count: 'exact', head: true })
      .eq('follower_id', id).eq('status', 'accepted'),
  ]);
  followCounts.set(handle, {
    followers: followers.count || 0,
    following: following.count || 0,
  });
}

// Fetch the list of profiles that follow `handle` (i.e. handle's followers).
// Returns an array of shaped user objects ready for renderAvatar() etc.
export async function followersOf(handle) {
  const supa = await getClient();
  const id = await userIdFromHandle(handle);
  if (!id) return [];
  const { data, error } = await supa
    .from('follows')
    .select('user:profiles!follows_follower_id_fkey(handle, name, avatar_url, avatar_shape, bio)')
    .eq('target_id', id)
    .eq('status', 'accepted')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(r => r.user).filter(Boolean).map(shapeProfile);
}

// Fetch the list of profiles that `handle` follows (i.e. handle's following).
export async function followingOf(handle) {
  const supa = await getClient();
  const id = await userIdFromHandle(handle);
  if (!id) return [];
  const { data, error } = await supa
    .from('follows')
    .select('user:profiles!follows_target_id_fkey(handle, name, avatar_url, avatar_shape, bio)')
    .eq('follower_id', id)
    .eq('status', 'accepted')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(r => r.user).filter(Boolean).map(shapeProfile);
}

function shapeProfile(p) {
  const name = p.name || 'User';
  return {
    handle:      p.handle,
    name,
    avatar:      (name[0] || '?').toUpperCase(),
    avatarImage: p.avatar_url || null,
    avatarShape: p.avatar_shape || 'round',
    bio:         p.bio || '',
  };
}

// Returns { state }, where state is one of:
//   'following' — accepted follow now exists
//   'requested' — pending follow now exists (private target)
//   'none'      — the follow / request was removed
export async function toggleFollow(myHandle, targetHandle) {
  const supa = await getClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) throw new Error('ログインしてください');
  const meta = await userMetaByHandle(targetHandle);
  if (!meta) throw new Error('対象ユーザーが見つかりません');
  if (user.id === meta.id) throw new Error('自分自身はフォローできません');

  const wasAccepted = followsMine.has(targetHandle);
  const wasPending  = requestsMine.has(targetHandle);

  // Tap on Following / Requested → remove the row entirely.
  if (wasAccepted || wasPending) {
    const { error } = await supa.from('follows')
      .delete().eq('follower_id', user.id).eq('target_id', meta.id);
    if (error) throw new Error(error.message);
    followsMine.delete(targetHandle);
    requestsMine.delete(targetHandle);
    if (wasAccepted) {
      // Bump cached counts — pending requests don't show in follower count.
      const target = followCounts.get(targetHandle);
      if (target) followCounts.set(targetHandle,
        { ...target, followers: Math.max(0, target.followers - 1) });
      const mine = myHandle ? followCounts.get(myHandle) : null;
      if (mine) followCounts.set(myHandle,
        { ...mine, following: Math.max(0, mine.following - 1) });
    }
    return { state: 'none' };
  }

  // Insert a new row. Private target → status pending. Public → accepted.
  const status = meta.is_private ? 'pending' : 'accepted';
  const { error } = await supa.from('follows')
    .insert({ follower_id: user.id, target_id: meta.id, status });
  if (error) throw new Error(error.message);
  if (status === 'accepted') {
    followsMine.add(targetHandle);
    const target = followCounts.get(targetHandle);
    if (target) followCounts.set(targetHandle,
      { ...target, followers: target.followers + 1 });
    const mine = myHandle ? followCounts.get(myHandle) : null;
    if (mine) followCounts.set(myHandle,
      { ...mine, following: mine.following + 1 });
    return { state: 'following' };
  }
  requestsMine.add(targetHandle);
  return { state: 'requested' };
}

// Pending follow requests addressed to ME (the current session user).
// Returned newest-first so the requests page can list them in order.
export async function pendingFollowRequests() {
  const supa = await getClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return [];
  const { data, error } = await supa
    .from('follows')
    .select('created_at, follower:profiles!follows_follower_id_fkey(handle, name, avatar_url, avatar_shape, bio, is_private)')
    .eq('target_id', user.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || [])
    .map(r => ({ user: shapeProfile(r.follower), createdAt: r.created_at }))
    .filter(r => r.user.handle);
}

// Flip a pending follow into accepted (RLS allows the target to update).
export async function acceptFollowRequest(followerHandle) {
  const supa = await getClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) throw new Error('ログインしてください');
  const followerId = await userIdFromHandle(followerHandle);
  if (!followerId) throw new Error('そのユーザーが見つかりません');
  const { error } = await supa.from('follows')
    .update({ status: 'accepted' })
    .eq('follower_id', followerId).eq('target_id', user.id);
  if (error) throw new Error(error.message);
}

// Reject the request — just delete the pending row.
export async function denyFollowRequest(followerHandle) {
  const supa = await getClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) throw new Error('ログインしてください');
  const followerId = await userIdFromHandle(followerHandle);
  if (!followerId) throw new Error('そのユーザーが見つかりません');
  const { error } = await supa.from('follows')
    .delete().eq('follower_id', followerId).eq('target_id', user.id);
  if (error) throw new Error(error.message);
}

// ----------------------------------------------------------------------
// UNIFIED NOTIFICATIONS
// ----------------------------------------------------------------------
//
// Pull every event addressed to the current user — likes / comments
// / reposts / bookmarks / quotes on their posts + follows + follow
// requests — and return them as one timeline sorted newest-first.
//
// Each query is independent so a missing Stage (10/11 SQL not yet
// run) just drops that notification type instead of failing the
// whole page. Author identity of each event is embedded so the view
// renders without a second round trip per row.
//
// Returns array of { type, actor, createdAt, post?, body?, status? }.
//   type      'like' | 'comment' | 'repost' | 'bookmark' | 'quote' |
//             'follow' | 'follow_request'
//   actor     shaped profile of the person who took the action
//   post      { id, body, createdAt } when the event is about one of
//             my posts (everything except follow/follow_request)
//   body      string — the comment body or the quoting post body
//   status    'pending' | 'accepted' for follow events
export async function notificationsForMe({ limit = 80 } = {}) {
  let supa; try { supa = await getClient(); } catch { return []; }
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return [];

  // First grab my own post ids — every author-side event needs them.
  // Capped at 200 so the IN-list stays small (Postgres / PostgREST
  // handle bigger but the round trip gets chunky).
  const { data: myPosts, error: myPostsErr } = await supa
    .from('posts').select('id, body, created_at')
    .eq('author_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200);
  if (myPostsErr) console.warn('notificationsForMe: myPosts', myPostsErr);
  const myPostIds = (myPosts || []).map(p => p.id);
  const postById = new Map();
  for (const p of (myPosts || [])) {
    postById.set(p.id, {
      id: p.id, body: p.body,
      createdAt: p.created_at ? new Date(p.created_at).getTime() : Date.now(),
    });
  }

  // Build one promise per source. Each handles its own errors so a
  // missing optional table / column doesn't kill the whole page.
  const tasks = [];

  // --- LIKES on my posts ---
  if (myPostIds.length) tasks.push((async () => {
    const { data, error } = await supa.from('likes')
      .select('post_id, created_at, user:profiles!likes_user_id_fkey(handle, name, avatar_url, avatar_shape, bio)')
      .in('post_id', myPostIds)
      .neq('user_id', user.id)   // ignore self-likes
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) { console.warn('notif likes', error); return []; }
    return (data || [])
      .filter(r => r.user?.handle)
      .map(r => ({
        type: 'like',
        actor: shapeProfile(r.user),
        createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
        post: postById.get(r.post_id),
      }));
  })());

  // --- COMMENTS on my posts ---
  if (myPostIds.length) tasks.push((async () => {
    const { data, error } = await supa.from('comments')
      .select('id, body, post_id, created_at, author:profiles!comments_author_id_fkey(handle, name, avatar_url, avatar_shape, bio)')
      .in('post_id', myPostIds)
      .neq('author_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) { console.warn('notif comments', error); return []; }
    return (data || [])
      .filter(r => r.author?.handle)
      .map(r => ({
        type: 'comment',
        actor: shapeProfile(r.author),
        createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
        post: postById.get(r.post_id),
        body: r.body,
      }));
  })());

  // Repost / bookmark / quote notifications removed by product request:
  // users only want like, comment, follow, follow_request, mention here.
  // The underlying tables still feed action counts on each post — only
  // the inbox surface is trimmed.

  // --- MENTIONS of me in any post body (someone else's post with
  //     "@<myHandle>" in it). Uses ilike for a coarse server-side filter
  //     and a strict word-boundary regex on the client so @aya doesn't
  //     match @aya526dev. Requires we know my own handle; pulled from
  //     the profiles table since the auth user only carries the id. ---
  const { data: meProfile } = await supa
    .from('profiles').select('handle').eq('id', user.id).maybeSingle();
  const myHandle = meProfile?.handle;
  if (myHandle) {
    const mentionRe = new RegExp(
      '(^|[^A-Za-z0-9_@])@' + myHandle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9_])',
      'i'
    );
    tasks.push((async () => {
      const { data, error } = await supa.from('posts')
        .select('id, body, created_at, author:profiles!posts_author_id_fkey(handle, name, avatar_url, avatar_shape, bio)')
        .ilike('body', '%@' + myHandle + '%')
        .neq('author_id', user.id)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) { console.warn('notif mentions (posts)', error); return []; }
      return (data || [])
        .filter(r => r.author?.handle && mentionRe.test(r.body || ''))
        .map(r => ({
          type: 'mention',
          actor: shapeProfile(r.author),
          createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
          post: { id: r.id, body: r.body, createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now() },
          body: r.body,
        }));
    })());
    tasks.push((async () => {
      const { data, error } = await supa.from('comments')
        .select('id, body, post_id, created_at, author:profiles!comments_author_id_fkey(handle, name, avatar_url, avatar_shape, bio)')
        .ilike('body', '%@' + myHandle + '%')
        .neq('author_id', user.id)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) { console.warn('notif mentions (comments)', error); return []; }
      return (data || [])
        .filter(r => r.author?.handle && mentionRe.test(r.body || ''))
        .map(r => ({
          type: 'mention',
          actor: shapeProfile(r.author),
          createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
          // Link the row to the post being commented on so the inbox
          // <a> navigates there; the body is the comment body.
          post: { id: r.post_id },
          body: r.body,
        }));
    })());
  }

  // --- FOLLOWS + FOLLOW REQUESTS targeting me ---
  tasks.push((async () => {
    const { data, error } = await supa.from('follows')
      .select('status, created_at, follower:profiles!follows_follower_id_fkey(handle, name, avatar_url, avatar_shape, bio, is_private)')
      .eq('target_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) { console.warn('notif follows', error); return []; }
    return (data || [])
      .filter(r => r.follower?.handle)
      .map(r => ({
        type: r.status === 'pending' ? 'follow_request' : 'follow',
        actor: shapeProfile(r.follower),
        createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
        status: r.status,
      }));
  })());

  const groups = await Promise.all(tasks);
  const merged = [].concat(...groups);
  merged.sort((a, b) => b.createdAt - a.createdAt);
  return merged.slice(0, limit);
}

// ----------------------------------------------------------------------
// REPOSTS / BOOKMARKS (Stage 11)
// ----------------------------------------------------------------------
//
// Both tables share the same (post_id, user_id) schema as `likes`. We
// keep per-post counts on posts.* (denormalised) — the timeline reads
// them out of the post row, no extra round trip. Per-viewer "mine"
// state is fetched once on demand (per visible post id batch) and
// cached in the Maps below.
//
// Schema-resilience: if the user hasn't run Stage 11 SQL the read paths
// just return {} / 0 / false instead of throwing, so the action
// buttons render their default (unliked) state without breaking the
// page. Write paths surface a friendly "Stage 11 SQL を実行…" message.

// (reposts + bookmarks maps declared at the top of the file alongside
// the other interaction caches; only the missing-table flags live here.)
//
// Same trick as data.js: cache the "table missing" flags in
// localStorage so subsequent page loads skip the table-not-found
// round trip. TTL guards against stale state — once the admin runs
// Stage 11 SQL, every user's session re-probes within an hour
// instead of being stuck on the false flag forever.
const INT_CACHE_KEY = 'spotcode:int-cache:v1';
const INT_CACHE_TTL_MS = 60 * 60 * 1000;
let repostsTableMissing   = false;
let bookmarksTableMissing = false;
(function loadIntCache() {
  try {
    const v = JSON.parse(localStorage.getItem(INT_CACHE_KEY) || '{}');
    if (!v.at || Date.now() - v.at > INT_CACHE_TTL_MS) return;
    if (v.repostsTableMissing   === true) repostsTableMissing   = true;
    if (v.bookmarksTableMissing === true) bookmarksTableMissing = true;
  } catch {}
})();
function persistIntCache() {
  try {
    localStorage.setItem(INT_CACHE_KEY, JSON.stringify({
      at: Date.now(),
      repostsTableMissing, bookmarksTableMissing,
    }));
  } catch {}
}

// One-shot probe used by data.js's probeSchema() at app boot. Hits
// `reposts` and `bookmarks` with HEAD-style 1-row selects so the
// table-missing flags get set before any visible-post batch tries
// to hydrate. Without this the first page load makes one 404 per
// optional table per visit; after this it makes zero.
export async function probeOptionalTables() {
  if (repostsTableMissing && bookmarksTableMissing) return;
  let supa; try { supa = await getClient(); } catch { return; }
  const probes = [];
  if (!repostsTableMissing) {
    probes.push(
      supa.from('reposts').select('post_id', { count: 'exact', head: true }).limit(1)
        .then(({ error }) => {
          if (error && isTableMissing(error, 'reposts')) {
            repostsTableMissing = true;
          }
        })
        .catch(() => {})
    );
  }
  if (!bookmarksTableMissing) {
    probes.push(
      supa.from('bookmarks').select('post_id', { count: 'exact', head: true }).limit(1)
        .then(({ error }) => {
          if (error && isTableMissing(error, 'bookmarks')) {
            bookmarksTableMissing = true;
          }
        })
        .catch(() => {})
    );
  }
  await Promise.all(probes);
  if (repostsTableMissing || bookmarksTableMissing) persistIntCache();
}

function isTableMissing(error, name) {
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes(name) && (
    msg.includes('does not exist') ||
    msg.includes('not found') ||
    msg.includes('relation') ||
    msg.includes('schema cache')
  );
}

export function isReposted(postId)   { return !!reposts.get(postId)?.mine; }
export function isBookmarked(postId) { return !!bookmarks.get(postId)?.mine; }

// Fill the `mine` flag for a batch of visible post ids. One round trip
// each. Silent on missing-table so nothing breaks before Stage 11.
export async function hydrateRepostsMine(postIds) {
  if (!postIds || !postIds.length || repostsTableMissing) return;
  let supa; try { supa = await getClient(); } catch { return; }
  const { data: { user } } = await supa.auth.getUser();
  if (!user) { for (const id of postIds) reposts.set(id, { mine: false }); return; }
  const { data, error } = await supa.from('reposts')
    .select('post_id').eq('user_id', user.id).in('post_id', postIds);
  if (error) {
    if (isTableMissing(error, 'reposts')) { repostsTableMissing = true; persistIntCache(); return; }
    console.warn('hydrateRepostsMine', error);
    return;
  }
  const mine = new Set((data || []).map(r => r.post_id));
  for (const id of postIds) reposts.set(id, { mine: mine.has(id) });
}
export async function hydrateBookmarksMine(postIds) {
  if (!postIds || !postIds.length || bookmarksTableMissing) return;
  let supa; try { supa = await getClient(); } catch { return; }
  const { data: { user } } = await supa.auth.getUser();
  if (!user) { for (const id of postIds) bookmarks.set(id, { mine: false }); return; }
  const { data, error } = await supa.from('bookmarks')
    .select('post_id').eq('user_id', user.id).in('post_id', postIds);
  if (error) {
    if (isTableMissing(error, 'bookmarks')) { bookmarksTableMissing = true; persistIntCache(); return; }
    console.warn('hydrateBookmarksMine', error);
    return;
  }
  const mine = new Set((data || []).map(r => r.post_id));
  for (const id of postIds) bookmarks.set(id, { mine: mine.has(id) });
}

// Paint poll bars + percentages onto already-rendered .poll cards.
// One bulk SELECT for every poll on the page, then walk the DOM and
// update each card's option buttons. Skipped silently when the
// poll_votes table isn't migrated yet — bars stay empty, votes
// throw migration-not-run when attempted.
export async function hydratePolls(posts) {
  if (!posts || !posts.length) return;
  const withPoll = posts.filter(p => p.poll && Array.isArray(p.poll.options));
  if (!withPoll.length) return;
  let supa; try { supa = await getClient(); } catch { return; }
  const { data: { user } } = await supa.auth.getUser();
  const ids = withPoll.map(p => p.id);
  const { data, error } = await supa.from('poll_votes')
    .select('post_id, option_idx, user_id').in('post_id', ids);
  if (error) return; // table likely missing — silent
  // Aggregate by post_id.
  const byPost = new Map();
  for (const row of (data || [])) {
    let bucket = byPost.get(row.post_id);
    if (!bucket) { bucket = { counts: [], total: 0, myChoice: null }; byPost.set(row.post_id, bucket); }
    const k = Number(row.option_idx);
    bucket.counts[k] = (bucket.counts[k] || 0) + 1;
    bucket.total += 1;
    if (user && row.user_id === user.id) bucket.myChoice = k;
  }
  // Paint.
  for (const p of withPoll) {
    const card = document.querySelector('.post[data-post-id="' + p.id + '"] .poll');
    if (!card) continue;
    const tally = byPost.get(p.id) || { counts: [], total: 0, myChoice: null };
    const closed = (Date.now() >= p.poll.deadlineAt);
    const reveal = closed || tally.myChoice != null;
    const opts = card.querySelectorAll('.poll__opt');
    opts.forEach((btn, i) => {
      const n = tally.counts[i] || 0;
      const pct = tally.total ? Math.round(100 * n / tally.total) : 0;
      const bar = btn.querySelector('.poll__opt-bar');
      const txt = btn.querySelector('.poll__opt-pct');
      if (reveal) {
        // Bar fills via transform: scaleX (GPU-composited, no reflow).
        // Was `width = N%` which triggered a layout per animation
        // frame per bar — janky on first paint with many polls.
        bar.style.transform = 'scaleX(' + (pct / 100) + ')';
        txt.textContent = pct + '%';
        btn.classList.toggle('poll__opt--mine', tally.myChoice === i);
      } else {
        bar.style.transform = 'scaleX(0)';
        txt.textContent = '';
      }
      btn.disabled = closed || tally.myChoice != null;
    });
    const totalSlot = card.querySelector('.poll__total');
    if (totalSlot) totalSlot.textContent = tally.total + ' 票';
  }
}

export async function toggleRepost(postId) {
  const supa = await getClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) throw new Error('ログインしてください');
  const state = reposts.get(postId) || { mine: false };
  if (state.mine) {
    const { error } = await supa.from('reposts')
      .delete().eq('post_id', postId).eq('user_id', user.id);
    if (error) {
      if (isTableMissing(error, 'reposts')) throw new Error('リポスト機能はまだセットアップされていません (Stage 11 SQL を実行してください)');
      throw new Error(error.message);
    }
    reposts.set(postId, { mine: false });
    return false;
  }
  const { error } = await supa.from('reposts').insert({ post_id: postId, user_id: user.id });
  if (error) {
    if (isTableMissing(error, 'reposts')) throw new Error('リポスト機能はまだセットアップされていません (Stage 11 SQL を実行してください)');
    throw new Error(error.message);
  }
  reposts.set(postId, { mine: true });
  return true;
}

export async function toggleBookmark(postId) {
  const supa = await getClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) throw new Error('ログインしてください');
  const state = bookmarks.get(postId) || { mine: false };
  if (state.mine) {
    const { error } = await supa.from('bookmarks')
      .delete().eq('post_id', postId).eq('user_id', user.id);
    if (error) {
      if (isTableMissing(error, 'bookmarks')) throw new Error('保存機能はまだセットアップされていません (Stage 11 SQL を実行してください)');
      throw new Error(error.message);
    }
    bookmarks.set(postId, { mine: false });
    return false;
  }
  const { error } = await supa.from('bookmarks').insert({ post_id: postId, user_id: user.id });
  if (error) {
    if (isTableMissing(error, 'bookmarks')) throw new Error('保存機能はまだセットアップされていません (Stage 11 SQL を実行してください)');
    throw new Error(error.message);
  }
  bookmarks.set(postId, { mine: true });
  return true;
}

// Author-only analytics list helpers. RLS on bookmarks already enforces
// "owner or post author only" so a non-author call will silently return
// fewer rows (only the viewer's own bookmark, if any). Reposts are
// publicly readable; the UI gates the dashboard route to the post author.
export async function repostersOf(postId) {
  if (!postId) return [];
  const supa = await getClient();
  const { data, error } = await supa.from('reposts')
    .select('created_at, user:profiles!reposts_user_id_fkey(handle, name, avatar_url, avatar_shape, bio)')
    .eq('post_id', postId)
    .order('created_at', { ascending: false });
  if (error) {
    if (isTableMissing(error, 'reposts')) return [];
    console.warn('repostersOf', error); return [];
  }
  return (data || [])
    .map(r => ({ user: shapeProfile(r.user || { name: '?' }), createdAt: r.created_at }))
    .filter(r => r.user.handle);
}
export async function bookmarkersOf(postId) {
  if (!postId) return [];
  const supa = await getClient();
  const { data, error } = await supa.from('bookmarks')
    .select('created_at, user:profiles!bookmarks_user_id_fkey(handle, name, avatar_url, avatar_shape, bio)')
    .eq('post_id', postId)
    .order('created_at', { ascending: false });
  if (error) {
    if (isTableMissing(error, 'bookmarks')) return [];
    console.warn('bookmarkersOf', error); return [];
  }
  return (data || [])
    .map(r => ({ user: shapeProfile(r.user || { name: '?' }), createdAt: r.created_at }))
    .filter(r => r.user.handle);
}

// Quoters: posts whose quote_of_post_id == this post id. Returns the
// quoting posts themselves (so the dashboard can render them inline).
export async function quotersOf(postId) {
  if (!postId) return [];
  const supa = await getClient();
  const { data, error } = await supa.from('posts')
    .select('id, body, created_at, author:profiles!posts_author_id_fkey(handle, name, avatar_url, avatar_shape, bio)')
    .eq('quote_of_post_id', postId)
    .order('created_at', { ascending: false });
  if (error) {
    const msg = String(error.message || '').toLowerCase();
    if (msg.includes('quote_of_post_id') && msg.includes('does not exist')) return [];
    console.warn('quotersOf', error); return [];
  }
  return (data || []).map(p => ({
    user:      shapeProfile(p.author || { name: '?' }),
    body:      p.body,
    postId:    p.id,
    createdAt: p.created_at,
  })).filter(r => r.user.handle);
}

// ----------------------------------------------------------------------
// COMMENTS
// ----------------------------------------------------------------------

// Was the error caused by the comments table not existing yet (Stage 10
// SQL hasn't been run)? If so we treat it as "no comments" everywhere.
function isCommentsTableMissing(error) {
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('comments') && (
    msg.includes('does not exist') ||
    msg.includes('not found') ||
    msg.includes('relation') ||
    msg.includes('schema cache')
  );
}

// Comment list for /post/<id>. Returns oldest-first so the thread reads
// in chronological order (Twitter style). Embeds the author profile so
// callers don't need a second round trip per row.
export async function getComments(postId) {
  if (!postId) return [];
  const supa = await getClient();
  const { data, error } = await supa
    .from('comments')
    .select('id, body, created_at, author:profiles!comments_author_id_fkey(handle, name, avatar_url, avatar_shape)')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  if (error) {
    if (isCommentsTableMissing(error)) {
      console.warn('comments table missing — run Stage 10 SQL.');
      return [];
    }
    throw new Error(error.message);
  }
  return (data || []).map(c => ({
    id:        c.id,
    body:      c.body,
    createdAt: c.created_at ? new Date(c.created_at).getTime() : Date.now(),
    author:    shapeProfile(c.author || { name: '?' }),
  }));
}

export async function addComment(postId, body) {
  const text = String(body || '').trim();
  if (!text) throw new Error('コメントを入力してください');
  const supa = await getClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) throw new Error('ログインしてください');
  const { data, error } = await supa.from('comments')
    .insert({ post_id: postId, author_id: user.id, body: text.slice(0, 500) })
    .select('id, body, created_at, author:profiles!comments_author_id_fkey(handle, name, avatar_url, avatar_shape)')
    .single();
  if (error) {
    if (isCommentsTableMissing(error)) {
      throw new Error('コメント機能はまだセットアップされていません (Stage 10 SQL を実行してください)');
    }
    throw new Error(error.message);
  }
  return {
    id:        data.id,
    body:      data.body,
    createdAt: data.created_at ? new Date(data.created_at).getTime() : Date.now(),
    author:    shapeProfile(data.author || { name: '?' }),
  };
}

export async function removeComment(commentId) {
  const supa = await getClient();
  const { data, error } = await supa
    .from('comments').delete().eq('id', commentId).select('id');
  if (error) throw new Error(error.message);
  if (!data || !data.length) throw new Error('削除権限がありません');
  return true;
}

// ----------------------------------------------------------------------
// POST ANALYTICS (visible to the post author only — enforced in UI)
// ----------------------------------------------------------------------

// Returns the list of users who liked a post, newest-first. Anyone can
// call this (likes table is publicly readable), but the dashboard view
// only links to it from the post author's own UI.
export async function likersOf(postId) {
  if (!postId) return [];
  const supa = await getClient();
  const { data, error } = await supa
    .from('likes')
    .select('created_at, user:profiles!likes_user_id_fkey(handle, name, avatar_url, avatar_shape, bio)')
    .eq('post_id', postId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || [])
    .map(r => ({ user: shapeProfile(r.user || { name: '?' }), createdAt: r.created_at }))
    .filter(r => r.user.handle);
}

// ----------------------------------------------------------------------
// REPORTS
// ----------------------------------------------------------------------

export async function reportPost({ postId, reason, comment }) {
  const supa = await getClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) throw new Error('ログインしてください');
  const row = {
    post_id:     postId,
    reporter_id: user.id,
    reason,
    comment:     comment ? String(comment).slice(0, 400) : null,
  };
  const { error } = await supa.from('reports')
    .upsert(row, { onConflict: 'post_id,reporter_id' });
  if (error) throw new Error(error.message);
}

export async function reportedByMe(postId) {
  let supa; try { supa = await getClient(); } catch { return false; }
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return false;
  const { data } = await supa
    .from('reports')
    .select('id')
    .eq('post_id', postId)
    .eq('reporter_id', user.id)
    .eq('resolved', false)
    .maybeSingle();
  return !!data;
}
