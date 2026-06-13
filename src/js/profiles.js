// Read-only profile lookups against public.profiles (Supabase).
//
// Fetches are cached into the same localStorage map that `data.js#getUser`
// reads, so once a profile has been fetched it appears in the sync getUser
// path and the user search dropdown without another round trip.

import { getClient } from './supa.js';
import { KEYS, read, write } from './storage.js';
import { expandQuery } from './jp-romaji.js';

// Project a profiles row into the UI-friendly user shape that the rest of
// the app uses (same fields as auth.js#projectUser, minus id/email).
function shapeProfile(row) {
  if (!row) return null;
  const name = row.name || 'User';
  return {
    handle:      row.handle,
    name,
    avatar:      (name[0] || '?').toUpperCase(),
    avatarImage: row.avatar_url || null,
    avatarShape: row.avatar_shape || 'round',
    bio:         row.bio || '',
    location:    row.location || '',
    role:        row.role || 'general',
    github:      row.github_handle
                   ? {
                       handle: row.github_handle,
                       url: 'https://github.com/' + row.github_handle,
                       verified: !!row.github_verified,
                     }
                   : null,
    joined:      row.created_at ? String(row.created_at).slice(0, 7) : '',
    _fetched:    Date.now(),
  };
}

function cacheLocally(profile) {
  if (!profile?.handle) return;
  const users = read(KEYS.users, {});
  users[profile.handle] = profile;
  write(KEYS.users, users);
}

const COLUMNS = 'handle, name, avatar_url, avatar_shape, bio, location, role, github_handle, github_verified, created_at';

export async function fetchProfileByHandle(handle) {
  if (!handle) return null;
  // Intentionally NOT short-circuiting on the localStorage cache here —
  // the profile page is the place where stale data hurts (e.g. another
  // user's freshly-uploaded avatar should appear without a hard reload),
  // and the round trip is cheap. The localStorage cache stays useful for
  // the sync renderPost path which can't await anyway.
  let supa;
  try { supa = await getClient(); } catch { return null; }
  const { data, error } = await supa
    .from('profiles')
    .select(COLUMNS)
    .eq('handle', handle)
    .maybeSingle();
  if (error) { console.warn('fetchProfileByHandle', error); return null; }
  const profile = shapeProfile(data);
  if (profile) cacheLocally(profile);
  return profile;
}

export async function searchProfiles(q, limit = 10) {
  if (!q) return [];
  let supa;
  try { supa = await getClient(); } catch { return []; }
  // Expand the query to its JP equivalents when it's a romaji slug
  // (e.g. "shibuya" → also try "渋谷区"). The user's display name might
  // contain the JP word even when their handle is ASCII-only.
  const forms = expandQuery(q);
  const orParts = [];
  for (const f of forms) {
    const safe = String(f).replace(/[%_\\,()]/g, c => '\\' + c);
    const pattern = '%' + safe + '%';
    orParts.push('handle.ilike.' + pattern);
    orParts.push('name.ilike.'   + pattern);
  }
  const { data, error } = await supa
    .from('profiles')
    .select(COLUMNS)
    .or(orParts.join(','))
    .limit(limit);
  if (error) { console.warn('searchProfiles', error); return []; }
  const profiles = (data || []).map(shapeProfile).filter(Boolean);
  // Opportunistically cache so subsequent visits are instant.
  profiles.forEach(cacheLocally);
  return profiles;
}
