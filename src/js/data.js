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
const POST_COLS =
  'id, body, github_link, spot, status, created_at, ' +
  'author:profiles!posts_author_id_fkey(handle, name, avatar_url, avatar_shape)';

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
  const supa = await getClient();
  const { data, error } = await supa
    .from('posts')
    .select(POST_COLS)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data || []).map(shapePost);
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
  const { data, error } = await supa
    .from('posts')
    .select(POST_COLS)
    .eq('author_id', prof.id)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(shapePost);
}

export async function postsByCity(city) {
  if (!city) return [];
  const supa = await getClient();
  // PostgREST JSONB path filter: spot->addressDetails->>city == city.
  // The post.spot column is jsonb and addressDetails is the nested
  // object we save from the picker.
  const { data, error } = await supa
    .from('posts')
    .select(POST_COLS)
    .eq('spot->addressDetails->>city', city)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
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
