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
// target handles that the current session user follows
const followsMine = new Set();
let followsMineLoaded = false;

export function clearInteractionsCache() {
  likes.clear();
  followCounts.clear();
  followsMine.clear();
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

async function userIdFromHandle(handle) {
  const supa = await getClient();
  const { data } = await supa.from('profiles').select('id').eq('handle', handle).maybeSingle();
  return data?.id || null;
}

// One round trip per session to know which handles the current user
// follows. Used by the sync `isFollowing()` getter.
export async function hydrateMyFollows() {
  if (followsMineLoaded) return;
  let supa; try { supa = await getClient(); } catch { return; }
  const { data: { user } } = await supa.auth.getUser();
  if (!user) { followsMineLoaded = true; return; }
  const { data } = await supa
    .from('follows')
    .select('target:profiles!follows_target_id_fkey(handle)')
    .eq('follower_id', user.id);
  followsMine.clear();
  for (const r of data || []) {
    if (r.target?.handle) followsMine.add(r.target.handle);
  }
  followsMineLoaded = true;
}

// Fill followCounts for a single user (used by profile page).
export async function hydrateProfileFollow(handle) {
  let supa; try { supa = await getClient(); } catch { return; }
  const id = await userIdFromHandle(handle);
  if (!id) return;
  const [followers, following] = await Promise.all([
    supa.from('follows').select('*', { count: 'exact', head: true }).eq('target_id', id),
    supa.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', id),
  ]);
  followCounts.set(handle, {
    followers: followers.count || 0,
    following: following.count || 0,
  });
}

export async function toggleFollow(myHandle, targetHandle) {
  const supa = await getClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) throw new Error('ログインしてください');
  const targetId = await userIdFromHandle(targetHandle);
  if (!targetId) throw new Error('対象ユーザーが見つかりません');
  if (user.id === targetId) throw new Error('自分自身はフォローできません');

  const already = followsMine.has(targetHandle);
  if (already) {
    const { error } = await supa.from('follows')
      .delete().eq('follower_id', user.id).eq('target_id', targetId);
    if (error) throw new Error(error.message);
    followsMine.delete(targetHandle);
  } else {
    const { error } = await supa.from('follows')
      .insert({ follower_id: user.id, target_id: targetId });
    if (error) throw new Error(error.message);
    followsMine.add(targetHandle);
  }

  // Bump cached counts optimistically.
  const delta = already ? -1 : 1;
  const target = followCounts.get(targetHandle);
  if (target) followCounts.set(targetHandle,
    { ...target, followers: Math.max(0, target.followers + delta) });
  const mine = myHandle ? followCounts.get(myHandle) : null;
  if (mine) followCounts.set(myHandle,
    { ...mine, following: Math.max(0, mine.following + delta) });

  return !already;
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
