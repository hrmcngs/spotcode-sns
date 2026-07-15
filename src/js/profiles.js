// Read-only profile lookups against public.profiles (Supabase).
//
// Fetches are cached into the same localStorage map that `data.js#getUser`
// reads, so once a profile has been fetched it appears in the sync getUser
// path and the user search dropdown without another round trip.

import { getClient } from './supa.js';
import { KEYS, read, write } from './storage.js';
import { expandQuery } from './jp-romaji.js';
import { cacheHandleId } from './data.js';

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
    isPrivate:   !!row.is_private,
    isOrg:       !!row.is_org,
    website:     row.website   || '',
    twitter:     row.twitter   || '',
    instagram:   row.instagram || '',
    closeFriends: Array.isArray(row.close_friends) ? row.close_friends : [],
    orgMembers:   Array.isArray(row.org_members)   ? row.org_members   : [],
    organization: row.organization || '',
    skills:       Array.isArray(row.skills) ? row.skills : [],
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

// `*` (not an explicit list) so that adding a column to public.profiles
// in a later migration doesn't break this query when run against an
// older DB — a missing column in an explicit select returns an error
// and the profile silently fails to load. Same defensiveness as
// loadProfile in auth.js.
const COLUMNS = '*';

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
  if (profile) {
    cacheLocally(profile);
    // Prime the handle→id lookup cache so postsByHandle /
    // likedPostsByHandle can skip their extra profile-id round trip.
    if (data && data.id) cacheHandleId(profile.handle, data.id);
  }
  return profile;
}

// "Recommended" users for the right-rail Who-to-follow card. Pulls
// the most-recently-created public profiles from Supabase so the
// suggestion list is populated even when the local user cache only
// knows about the viewer themselves. `excludeHandles` filters out
// the viewer + anyone they already follow; the caller is expected
// to pass that set so the suggestions never include duplicates of
// what the viewer is already connected to.
export async function recommendedProfiles({ limit = 5, excludeHandles = [] } = {}) {
  let supa;
  try { supa = await getClient(); } catch { return []; }
  // Over-fetch a bit so we still have N results after filtering out
  // the excludeHandles set client-side. (Doing the exclusion in SQL
  // would need a NOT IN clause that grows with every follow.)
  const buffer = Math.max(limit + excludeHandles.length, limit * 3);
  const { data, error } = await supa
    .from('profiles')
    .select(COLUMNS)
    .order('created_at', { ascending: false })
    .limit(buffer);
  if (error) { console.warn('recommendedProfiles', error); return []; }
  const excludeLower = new Set(
    excludeHandles.map(h => String(h || '').toLowerCase()).filter(Boolean)
  );
  const profiles = (data || [])
    .map(shapeProfile)
    .filter(Boolean)
    .filter(p => !excludeLower.has(String(p.handle || '').toLowerCase()))
    .slice(0, limit);
  // Cache for the right-rail's allUsers() fallback + the search dropdown.
  profiles.forEach(cacheLocally);
  return profiles;
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
