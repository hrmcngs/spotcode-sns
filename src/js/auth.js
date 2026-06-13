// Auth backed by Supabase. Replaces the previous localStorage-only
// implementation so accounts survive across devices and browsers.
//
// Surface (kept compatible with the previous version so view code doesn't
// have to change much):
//   currentUser()         — cached merged { id, email, handle, name, avatar, ... } | null
//   onAuthChange(fn)      — subscribe to login / logout / profile changes
//   initAuth()            — bootstraps cachedUser from the active session
//   register({...})       — Supabase signUp + profile post-fill
//   login({...})          — Supabase signInWithPassword
//   logout()              — Supabase signOut + clear cache
//   updateProfile(patch)  — writes to public.profiles + refreshes cache
//   fetchGithubProfile(h) — same public GitHub API lookup as before

import { getClient } from './supa.js';

const subscribers = new Set();
let cachedUser = null;
let initialized = false;

function emit() { subscribers.forEach(fn => { try { fn(cachedUser); } catch {} }); }

export function onAuthChange(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }
export function currentUser() { return cachedUser; }

// Build the UI-facing user object from a Supabase auth user + profiles row.
function projectUser(authUser, profile) {
  if (!authUser || !profile) return null;
  const name = profile.name || authUser.email || 'User';
  return {
    id:          authUser.id,
    email:       authUser.email,
    handle:      profile.handle,
    name,
    avatar:      (name[0] || '?').toUpperCase(),
    avatarImage: profile.avatar_url || null,
    avatarShape: profile.avatar_shape || 'round',
    bio:         profile.bio || '',
    location:    profile.location || '',
    role:        profile.role || 'general',
    github:      profile.github_handle
                   ? {
                       handle: profile.github_handle,
                       url: 'https://github.com/' + profile.github_handle,
                       verified: !!profile.github_verified,
                       verifyToken: profile.github_verify_token || null,
                     }
                   : null,
    isPrivate:   !!profile.is_private,
    website:     profile.website   || '',
    twitter:     profile.twitter   || '',
    instagram:   profile.instagram || '',
    joined:      profile.created_at ? String(profile.created_at).slice(0, 7) : '',
  };
}

async function loadProfile(userId) {
  const supa = await getClient();
  // Use `*` so that newly-added optional columns (Stage 9 website /
  // twitter / instagram, future Stage Ns) don't break login if the
  // user hasn't run the corresponding migration yet — a missing column
  // in an explicit select list returns an error → null profile → the
  // user appears logged out even though the auth session is fine.
  // `projectUser` already defaults every field with `|| ''` / `|| null`
  // so a missing column just renders as empty in the UI.
  const { data, error } = await supa
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) { console.warn('loadProfile error', error); return null; }
  return data;
}

async function refreshFromSession() {
  let supa;
  try { supa = await getClient(); } catch { cachedUser = null; emit(); return; }
  const { data } = await supa.auth.getSession();
  const session = data?.session;
  if (!session) { cachedUser = null; emit(); return; }
  const profile = await loadProfile(session.user.id);
  cachedUser = projectUser(session.user, profile);
  emit();
}

export async function initAuth() {
  if (initialized) return;
  initialized = true;
  let supa;
  try { supa = await getClient(); }
  catch { cachedUser = null; return; }

  const { data } = await supa.auth.getSession();
  if (data?.session) {
    const profile = await loadProfile(data.session.user.id);
    cachedUser = projectUser(data.session.user, profile);
  }

  supa.auth.onAuthStateChange(async (_event, session) => {
    if (!session) { cachedUser = null; emit(); return; }
    const profile = await loadProfile(session.user.id);
    cachedUser = projectUser(session.user, profile);
    emit();
  });
}

// Validate a GitHub handle by hitting the unauthenticated public API.
export async function fetchGithubProfile(handle) {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(handle)) return null;
  try {
    const r = await fetch('https://api.github.com/users/' + encodeURIComponent(handle), {
      headers: { 'Accept': 'application/vnd.github+json' },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function emailLooksValid(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function handleLooksValid(h) { return /^[A-Za-z0-9_]{2,20}$/.test(h); }

async function isHandleTaken(handle) {
  const supa = await getClient();
  const { data } = await supa.from('profiles').select('handle').eq('handle', handle).maybeSingle();
  return !!data;
}

function translateAuthError(msg) {
  if (!msg) return 'エラーが発生しました';
  const m = String(msg).toLowerCase();
  if (m.includes('invalid login'))           return 'メールアドレスかパスワードが違います';
  if (m.includes('email not confirmed'))     return 'メール確認が完了していません';
  if (m.includes('user already registered')) return 'このメールは既に登録されています';
  if (m.includes('already registered'))      return 'このメールは既に登録されています';
  return msg;
}

export async function register({ email, password, handle, name, role, githubHandle }) {
  if (!emailLooksValid(email))           throw new Error('メールアドレスの形式が正しくありません');
  if (!password || password.length < 8)  throw new Error('パスワードは 8 文字以上にしてください');
  if (!handleLooksValid(handle))         throw new Error('ハンドルは半角英数_の 2〜20 文字');
  if (!name || !name.trim())             throw new Error('表示名を入力してください');
  if (role === 'programmer' && !githubHandle) {
    throw new Error('Programmer ロールは GitHub 連携が必須です');
  }

  if (await isHandleTaken(handle)) throw new Error('そのハンドルは既に使われています');

  if (githubHandle) {
    const gh = await fetchGithubProfile(githubHandle);
    if (!gh) throw new Error('GitHub ユーザー「' + githubHandle + '」が見つかりませんでした');
  }

  const supa = await getClient();
  const { data, error } = await supa.auth.signUp({
    email,
    password,
    options: { data: { handle, name: name.trim() } },
  });
  if (error) throw new Error(translateAuthError(error.message));
  const user = data?.user;
  if (!user) throw new Error('サインアップに失敗しました');

  // The handle_new_user trigger created the profile shell from raw_user_meta_data.
  // Patch the extra fields the trigger doesn't know about.
  const patch = {};
  if (role) patch.role = role;
  if (githubHandle) patch.github_handle = githubHandle;
  if (Object.keys(patch).length) {
    const { error: upErr } = await supa.from('profiles').update(patch).eq('id', user.id);
    if (upErr) console.warn('profile post-update failed', upErr);
  }

  await refreshFromSession();
  return cachedUser;
}

export async function login({ email, password }) {
  const supa = await getClient();
  const { error } = await supa.auth.signInWithPassword({ email, password });
  if (error) throw new Error(translateAuthError(error.message));
  await refreshFromSession();
  return cachedUser;
}

export async function logout() {
  try {
    const supa = await getClient();
    await supa.auth.signOut();
  } catch {}
  cachedUser = null;
  emit();
}

// Normalise a Twitter / Instagram handle: strip @, any URL prefix,
// any trailing slash / query, lowercase whitespace trim. Empty → null
// so the column reads as "not set" instead of "empty string".
function sanitizeHandle(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  // Strip a pasted URL form (https://twitter.com/foo, https://x.com/foo,
  // https://instagram.com/foo) down to the handle.
  s = s.replace(/^https?:\/\/(www\.)?(twitter|x|instagram)\.com\//i, '');
  s = s.replace(/^@/, '');
  s = s.replace(/[\/?#].*$/, '');
  s = s.slice(0, 30);
  return s || null;
}

export async function updateProfile(patch) {
  if (!cachedUser) throw new Error('ログインしていません');
  const supa = await getClient();
  const db = {};
  if (patch.name != null)              db.name         = String(patch.name).trim();
  if (patch.bio != null)               db.bio          = String(patch.bio).slice(0, 280);
  if (patch.location != null)          db.location     = String(patch.location).slice(0, 60);
  if (patch.avatarImage !== undefined) db.avatar_url   = patch.avatarImage || null;
  if (patch.avatarShape != null)       db.avatar_shape = patch.avatarShape;
  if (patch.isPrivate   !== undefined) db.is_private   = !!patch.isPrivate;
  if (patch.website   != null)         db.website      = String(patch.website).trim().slice(0, 200)   || null;
  if (patch.twitter   != null)         db.twitter      = sanitizeHandle(patch.twitter);
  if (patch.instagram != null)         db.instagram    = sanitizeHandle(patch.instagram);
  if (Object.keys(db).length) {
    const { error } = await supa.from('profiles').update(db).eq('id', cachedUser.id);
    if (error) throw new Error(error.message);
  }
  await refreshFromSession();
  return cachedUser;
}
