// Likes / follows / reports backed by Supabase (Stage 5).
//
// Reads are served from small in-memory caches populated by `hydrate*()`
// helpers, so the existing sync getters (`likeCount(postId)` etc) keep
// the render path simple. Writes are async and update the cache
// optimistically before the round trip.

import { getClient } from './supa.js';

// post id  -> { count, mine }
const likes = new Map();
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
