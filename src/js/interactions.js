// Persistent likes, follows and reports. Stored in localStorage as:
//   spotcode:likes   → { [postId]: [handles] }
//   spotcode:follows → { [followerHandle]: [targetHandles] }
//   spotcode:reports → [ { id, postId, reporter, reason, comment, ts, resolved } ]

import { read, write } from './storage.js';

const LIKES   = 'spotcode:likes';
const FOLLOWS = 'spotcode:follows';
const REPORTS = 'spotcode:reports';

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

// ----- reports -----

function readReports()  { return read(REPORTS, []); }
function writeReports(a){ write(REPORTS, a); }

export function reportPost({ postId, reporter, reason, comment }) {
  if (!postId || !reporter || !reason) throw new Error('postId / reporter / reason は必須です');
  const reports = readReports();
  // De-dupe: a single reporter can only have one active report per post.
  const idx = reports.findIndex(r => r.postId === postId && r.reporter === reporter && !r.resolved);
  const entry = {
    id: 'r' + Date.now() + Math.floor(Math.random() * 1000),
    postId, reporter, reason,
    comment: comment ? String(comment).slice(0, 400) : '',
    ts: Date.now(),
    resolved: false,
  };
  if (idx >= 0) reports[idx] = entry;
  else reports.unshift(entry);
  writeReports(reports);
  return entry;
}

export function allReports() { return readReports(); }

export function pendingReports() {
  return readReports().filter(r => !r.resolved);
}

export function reportsForPost(postId) {
  return readReports().filter(r => r.postId === postId);
}

export function reportedByMe(postId, handle) {
  if (!postId || !handle) return false;
  return readReports().some(r => r.postId === postId && r.reporter === handle && !r.resolved);
}

export function resolveReports(postId) {
  const reports = readReports();
  let changed = false;
  for (const r of reports) {
    if (r.postId === postId && !r.resolved) { r.resolved = true; r.resolvedAt = Date.now(); changed = true; }
  }
  if (changed) writeReports(reports);
  return changed;
}
