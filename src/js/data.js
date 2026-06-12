// Data layer.
//
// Users are now backed by Supabase (auth.users + public.profiles). The
// localStorage user store is no longer written to, but the readers stay
// to render any data that was saved before the Supabase migration.
// `getUser()` falls back to the current Supabase session user so the UI
// can render the author of own posts even before Stage 3 wires in
// cross-device profile lookups.
//
// Posts / likes / follows are still localStorage-only here; Stage 4 onward
// move them to Supabase.

import { KEYS, read, write } from './storage.js';
import { currentUser }       from './auth.js';

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

export function allPosts() {
  return read(KEYS.posts, []);
}

export function postsByHandle(handle) {
  return allPosts().filter(p => p.authorHandle === handle);
}

export function addPost(post) {
  const stored = read(KEYS.posts, []);
  stored.unshift(post);
  write(KEYS.posts, stored);
  return post;
}

export function removePost(postId) {
  const stored = read(KEYS.posts, []);
  const next = stored.filter(p => p.id !== postId);
  if (next.length === stored.length) return false;
  write(KEYS.posts, next);
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
