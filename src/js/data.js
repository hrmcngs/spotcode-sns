// Data layer. Only what the user has actually saved locally — no seed
// users or posts. Swap these functions for an API client later.

import { KEYS, read, write } from './storage.js';

export function allUsers() {
  return read(KEYS.users, {});
}

export function getUser(handle) {
  return allUsers()[handle] || null;
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
