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
import {
  rememberAccount, forgetAccount, getRefreshToken,
  setPendingSwitch, consumePendingSwitch,
} from './saved-accounts.js';

const subscribers = new Set();
let cachedUser = null;
let initialized = false;

// Re-export the public list-view directly so view code can import from
// './auth.js' without having to know about saved-accounts.js. The
// refresh-token-bearing helpers (rememberAccount / getRefreshToken)
// stay private to this module so they can't leak via import paths.
export { listSavedAccounts, forgetAccount as removeSavedAccount } from './saved-accounts.js';

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
    isOrg:       !!profile.is_org,
    website:     profile.website   || '',
    twitter:     profile.twitter   || '',
    instagram:   profile.instagram || '',
    // Stage 16 / 19 — visibility audiences. Two curated handle lists
    // (close friends + org members) plus a free-text org label that
    // shows on profiles but is NOT used for visibility matching
    // anymore (Stage 19).
    closeFriends: Array.isArray(profile.close_friends) ? profile.close_friends : [],
    orgMembers:   Array.isArray(profile.org_members)   ? profile.org_members   : [],
    organization: profile.organization || '',
    // Self-selected language badge ids. Empty array on profiles
    // that haven't run Stage 22 yet — the UI just shows no badges.
    skills:       Array.isArray(profile.skills)        ? profile.skills        : [],
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
  // Snapshot the session in the saved-accounts list so the user can
  // flip back to this account later without re-typing their password.
  if (cachedUser) rememberAccount({ user: cachedUser, session });
  emit();
}

export async function initAuth() {
  if (initialized) return;
  initialized = true;
  let supa;
  try { supa = await getClient(); }
  catch { cachedUser = null; return; }

  // Process a staged account switch BEFORE we attach the
  // onAuthStateChange subscriber. supabase-js's auto-refresh timer
  // hasn't started yet either — refreshSession runs on a fresh
  // runtime, which is the only configuration we've found that
  // reliably survives back-to-back switches.
  const pendingId = consumePendingSwitch();
  if (pendingId) {
    const refreshToken = getRefreshToken(pendingId);
    if (refreshToken) {
      try {
        const { data: rs, error } = await supa.auth.refreshSession({ refresh_token: refreshToken });
        if (error || !rs?.session) {
          // Saved token rejected — drop the entry so the row in
          // /settings disappears instead of failing again on every
          // boot. The session supabase-js loaded from storage stays
          // (we never signed it out), so the user lands on whichever
          // account was active before the staged switch.
          forgetAccount(pendingId);
        }
      } catch {
        forgetAccount(pendingId);
      }
    }
  }

  const { data } = await supa.auth.getSession();
  if (data?.session) {
    const profile = await loadProfile(data.session.user.id);
    cachedUser = projectUser(data.session.user, profile);
    if (cachedUser) rememberAccount({ user: cachedUser, session: data.session });
  }

  supa.auth.onAuthStateChange(async (_event, session) => {
    if (!session) { cachedUser = null; emit(); return; }
    const profile = await loadProfile(session.user.id);
    cachedUser = projectUser(session.user, profile);
    // Persist the latest refresh_token — supabase-js rotates it on
    // every refresh, and a stale one is useless for switchAccount.
    if (cachedUser) rememberAccount({ user: cachedUser, session });
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
function handleLooksValid(h) { return /^[A-Za-z0-9_][A-Za-z0-9_-]{1,19}$/.test(h); }

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

export async function register({ email, password, handle, name, role, githubHandle, kind }) {
  if (!emailLooksValid(email))           throw new Error('メールアドレスの形式が正しくありません');
  if (!password || password.length < 8)  throw new Error('パスワードは 8 文字以上にしてください');
  if (!handleLooksValid(handle))         throw new Error('ハンドルは半角英数 _ - の 2〜20 文字（先頭は - 不可）');
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
  if (kind === 'org') patch.is_org = true;
  if (Object.keys(patch).length) {
    // Same drop-on-missing-column retry as updateProfile so a not-yet-migrated
    // DB (no Stage 20 is_org column) still completes sign-up — the new column
    // just silently degrades to its default until the admin runs the SQL.
    for (let i = 0; i < 5; i++) {
      const { error: upErr } = await supa.from('profiles').update(patch).eq('id', user.id);
      if (!upErr) break;
      const col = parseMissingCol(upErr);
      if (col && col === 'is_org' && 'is_org' in patch) { delete patch.is_org; continue; }
      console.warn('profile post-update failed', upErr);
      break;
    }
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
  const me = cachedUser;
  try {
    const supa = await getClient();
    await supa.auth.signOut();
  } catch {}
  // Mirror the user's mental model: "I logged out → my account isn't
  // on this device anymore." If they want it back in the switcher
  // they can log in again.
  if (me?.id) forgetAccount(me.id);
  cachedUser = null;
  emit();
}

// Flip into a different saved account. We do the actual session swap
// at the *next* page boot (initAuth processes the pending flag), not
// in-page — back-to-back in-page refreshSession calls collided with
// supabase-js's auto-refresh timer and stale onAuthStateChange
// subscribers, which left both accounts looking logged out. Reloading
// kills the runtime so the next initAuth runs against a clean slate.
//
// Returns a never-resolving Promise so the caller's `await` blocks
// the UI until the reload takes over (no flash of post-switch state
// against the still-current account). Synchronous throws for the
// guard cases below short-circuit before scheduling the reload.
export function switchAccount(id) {
  if (cachedUser && cachedUser.id === id) return Promise.resolve(cachedUser);
  if (!getRefreshToken(id)) {
    return Promise.reject(new Error('保存済みアカウントが見つかりません'));
  }
  setPendingSwitch(id);
  // Defer the reload one tick so the caller's UI-disable code can
  // paint a "切り替え中…" status before the page disappears.
  setTimeout(() => location.reload(), 0);
  return new Promise(() => {});
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

// Writes are infrequent compared to reads, so updateProfile no longer
// pre-filters columns based on a cached flag — it always sends the
// full patch and only drops a column when PostgREST explicitly errors
// on it. That means as soon as the admin runs Stage 9 SQL, every
// user's next Save just succeeds, without needing to clear localStorage
// or wait for any cache TTL. The previous "trust the cache" version
// silently stripped fields for users who'd ever hit the missing-column
// state, which made the feature look broken for them even after the
// migration shipped.
function parseMissingCol(error) {
  const msg = String(error?.message || '');
  const m = msg.match(/'([a-z_]+)' column/i) || msg.match(/column "?([a-z_]+)"? .*does not exist/i);
  return m && m[1] || null;
}

export async function updateProfile(patch) {
  if (!cachedUser) throw new Error('ログインしていません');
  // Refuse to write while the "posting as official" overlay is on —
  // the user is viewing settings as @spotcode_official but their
  // auth.uid() is still the real staffer, so the RLS update would
  // either silently rewrite the wrong row or 403. Surface a clear
  // message instead.
  let postingAsOfficial = false;
  try {
    const { isPostingAsOfficial } = await import('./posting-identity.js');
    postingAsOfficial = !!isPostingAsOfficial();
  } catch {}
  if (postingAsOfficial) {
    throw new Error('公式モード中は自分のプロフィールを編集できません。アバターメニューで自分に戻ってから保存してください。');
  }
  const supa = await getClient();
  const db = {};
  if (patch.name != null)              db.name         = String(patch.name).trim();
  if (patch.bio != null)               db.bio          = String(patch.bio).slice(0, 280);
  if (patch.location != null)          db.location     = String(patch.location).slice(0, 60);
  if (patch.avatarImage !== undefined) db.avatar_url   = patch.avatarImage || null;
  if (patch.avatarShape != null)       db.avatar_shape = patch.avatarShape;
  if (patch.isPrivate   !== undefined) db.is_private   = !!patch.isPrivate;
  if (patch.isOrg       !== undefined) db.is_org       = !!patch.isOrg;
  if (patch.website   != null)         db.website      = String(patch.website).trim().slice(0, 200) || null;
  if (patch.twitter   != null)         db.twitter      = sanitizeHandle(patch.twitter);
  if (patch.instagram != null)         db.instagram    = sanitizeHandle(patch.instagram);
  if (patch.closeFriends != null)      db.close_friends = (Array.isArray(patch.closeFriends) ? patch.closeFriends : [])
                                                            .map(h => String(h).trim()).filter(Boolean);
  if (patch.orgMembers   != null)      db.org_members   = (Array.isArray(patch.orgMembers) ? patch.orgMembers : [])
                                                            .map(h => String(h).trim()).filter(Boolean);
  if (patch.organization != null)      db.organization  = String(patch.organization).trim().slice(0, 80) || null;
  if (patch.skills       != null)      db.skills        = (Array.isArray(patch.skills) ? patch.skills : [])
                                                            .map(s => String(s).trim()).filter(Boolean);

  const OPTIONAL_PROFILE_COLS = new Set(['website', 'twitter', 'instagram', 'close_friends', 'org_members', 'organization', 'is_org', 'skills']);
  // Track which columns we had to drop so we can surface a real error
  // when the patch was *entirely* dropped — previously the function
  // returned "success" silently, leaving the user with a green
  // "saved" status and no data persisted (looked like the editor
  // was broken).
  const droppedCols = [];
  if (Object.keys(db).length) {
    // Retry loop: PostgREST returns one missing column per request.
    // For each error, identify the column and drop it ONLY if it's in
    // the known-optional set — otherwise rethrow (don't silently lose
    // user data on a typo / RLS bug).
    let lastErrorMsg = '';
    for (let i = 0; i < 5; i++) {
      const { error } = await supa.from('profiles').update(db).eq('id', cachedUser.id);
      if (!error) break;
      lastErrorMsg = error.message || '';
      const col = parseMissingCol(error);
      if (!col || !OPTIONAL_PROFILE_COLS.has(col) || !(col in db)) throw new Error(lastErrorMsg);
      console.warn('profiles.' + col + ' missing — run the corresponding Stage SQL (see docs/supabase-schema.sql). Dropping from this save.');
      droppedCols.push(col);
      delete db[col];
      if (Object.keys(db).length === 0) break;
    }
    if (droppedCols.length && Object.keys(db).length === 0) {
      throw new Error(
        'DB に列が無いため保存できませんでした: ' + droppedCols.join(', ') +
        '。docs/supabase-schema.sql の該当 Stage を Supabase で実行してください。'
      );
    }
  }
  await refreshFromSession();
  return cachedUser;
}
