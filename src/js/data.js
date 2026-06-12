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

const POST_COLS =
  'id, body, github_link, spot, status, created_at, ' +
  'author:profiles(handle, name, avatar_url, avatar_shape)';

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
  // can find them on subsequent renders.
  if (author?.handle) {
    const users = read(KEYS.users, {});
    if (!users[author.handle] || !users[author.handle]._fetched) {
      users[author.handle] = { ...author, _fetched: Date.now() };
      write(KEYS.users, users);
    }
  }
  return {
    id:           row.id,
    authorHandle: author?.handle || '?',
    author,
    body:         row.body,
    githubLink:   row.github_link || undefined,
    spot:         row.spot || null,
    status:       row.status || 'wip',
    createdAt:    row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    actions:      { replies: 0, forks: 0, stars: 0, likes: 0 },
  };
}

export async function allPosts({ limit = 100 } = {}) {
  let supa;
  try { supa = await getClient(); } catch { return []; }
  const { data, error } = await supa
    .from('posts')
    .select(POST_COLS)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.warn('allPosts', error); return []; }
  return (data || []).map(shapePost);
}

export async function postsByHandle(handle) {
  if (!handle) return [];
  let supa;
  try { supa = await getClient(); } catch { return []; }
  const { data: prof } = await supa
    .from('profiles')
    .select('id')
    .eq('handle', handle)
    .maybeSingle();
  if (!prof) return [];
  const { data, error } = await supa
    .from('posts')
    .select(POST_COLS)
    .eq('author_id', prof.id)
    .order('created_at', { ascending: false });
  if (error) { console.warn('postsByHandle', error); return []; }
  return (data || []).map(shapePost);
}

export async function addPost(post) {
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
  const { data, error } = await supa.from('posts').insert(row).select(POST_COLS).single();
  if (error) throw new Error(error.message);
  return shapePost(data);
}

export async function removePost(postId) {
  const supa = await getClient();
  const { error } = await supa.from('posts').delete().eq('id', postId);
  if (error) throw new Error(error.message);
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
