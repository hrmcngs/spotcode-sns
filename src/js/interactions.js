// Persistent likes and follows. Stored in localStorage as:
//   spotcode:likes   → { [postId]: [handles] }
//   spotcode:follows → { [followerHandle]: [targetHandles] }

import { read, write } from './storage.js';

const LIKES   = 'spotcode:likes';
const FOLLOWS = 'spotcode:follows';

// ----- likes -----

function readLikes()  { return read(LIKES, {}); }
function writeLikes(o){ write(LIKES, o); }

export function isLiked(postId, handle) {
  if (!postId || !handle) return false;
  return (readLikes()[postId] || []).includes(handle);
}

export function likeCount(postId) {
  if (!postId) return 0;
  return (readLikes()[postId] || []).length;
}

export function toggleLike(postId, handle) {
  if (!postId || !handle) return false;
  const all = readLikes();
  const set = new Set(all[postId] || []);
  const nowLiked = !set.has(handle);
  if (nowLiked) set.add(handle); else set.delete(handle);
  if (set.size) all[postId] = Array.from(set);
  else delete all[postId];
  writeLikes(all);
  return nowLiked;
}

// ----- follows -----

function readFollows()   { return read(FOLLOWS, {}); }
function writeFollows(o) { write(FOLLOWS, o); }

export function isFollowing(myHandle, targetHandle) {
  if (!myHandle || !targetHandle) return false;
  return (readFollows()[myHandle] || []).includes(targetHandle);
}

export function followingCount(handle) {
  if (!handle) return 0;
  return (readFollows()[handle] || []).length;
}

export function followerCount(handle) {
  if (!handle) return 0;
  const follows = readFollows();
  let n = 0;
  for (const arr of Object.values(follows)) if (arr.includes(handle)) n++;
  return n;
}

export function toggleFollow(myHandle, targetHandle) {
  if (!myHandle || !targetHandle || myHandle === targetHandle) return false;
  const all = readFollows();
  const set = new Set(all[myHandle] || []);
  const nowFollowing = !set.has(targetHandle);
  if (nowFollowing) set.add(targetHandle); else set.delete(targetHandle);
  if (set.size) all[myHandle] = Array.from(set);
  else delete all[myHandle];
  writeFollows(all);
  return nowFollowing;
}
