// GitHub identity linking via Supabase's built-in OAuth provider.
//
// Why via Supabase (not straight to GitHub's OAuth endpoint):
// the OAuth token-exchange step needs `client_secret`, which cannot
// live in a static site. Supabase's Auth service holds the secret
// server-side and does the exchange for us — the browser only ever
// sees `redirectTo` → GitHub consent → back to the app with an
// access token pinned to the user's Supabase session.
//
// Prerequisites (see docs/github-oauth-setup.md):
//   1. Register a GitHub OAuth App with callback
//      https://<project-ref>.supabase.co/auth/v1/callback
//   2. Paste its Client ID / Secret into
//      Supabase Dashboard → Authentication → Providers → GitHub → Enable
//
// Flow at runtime:
//   linkGithub()           kicks off the redirect
//   … browser round-trips …
//   syncGithubIdentity()   reads the linked identity back off the
//                          Supabase user and mirrors user_name into
//                          public.profiles.github_handle. Called on
//                          every auth-ready tick so a fresh return
//                          from the redirect always lands here.

import { getClient } from './supa.js';
import { refreshProfile, currentUser } from './auth.js';

const PRIVATE_ISSUE_SESSION_KEY = 'spotcode.private_issue_original_session';

async function saveSharedGithubToken(token) {
  if (!token) return;
  const supa = await getClient();
  const { error } = await supa.rpc('save_github_private_issue_token', { p_token: token });
  if (error && !/save_github_private_issue_token/i.test(error.message || '')) throw new Error(error.message);
}

async function getSharedGithubToken() {
  const supa = await getClient();
  const { data, error } = await supa.rpc('get_github_private_issue_token');
  if (error) return null; // Stage 34 not installed yet.
  return typeof data === 'string' && data ? data : null;
}

// Kick off the link flow. Supabase-js redirects the browser to
// github.com's consent page; when the user approves, GitHub bounces
// them to the Supabase project's /auth/v1/callback, and Supabase
// finally sends them back to `redirectTo` with a session tacked onto
// the URL fragment. The default `redirectTo` is the current URL so
// the user lands right back where they were (the edit-profile modal).
//
// Scope: read:user identifies the user; read:org verifies organization membership. We intentionally do NOT request `repo` — this is an identity
// link and organization-membership grant. Private repository access is optional.
export async function linkGithub(redirectTo = window.location.href) {
  const supa = await getClient();
  const { data, error } = await supa.auth.linkIdentity({
    provider: 'github',
    options: { redirectTo, scopes: 'read:user read:org' },
  });
  if (error) throw new Error(error.message);
  return data;
}

// Explicit opt-in for private issue display. GitHub's classic OAuth
// scopes do not offer a narrower read-only private-issues permission;
// `repo` is therefore requested only after the user enables this feature.
export async function linkGithubForPrivateIssues(redirectTo = window.location.href, includePrivate = true) {
  const supa = await getClient();
  const { data: before } = await supa.auth.getSession();
  if (!before?.session) throw new Error('先にspotcodeへログインしてください');
  try {
    sessionStorage.setItem(PRIVATE_ISSUE_SESSION_KEY, JSON.stringify({
      access_token: before.session.access_token,
      refresh_token: before.session.refresh_token,
      user_id: before.session.user.id,
    }));
  } catch {}
  const returnUrl = new URL(redirectTo, window.location.href);
  returnUrl.hash = '';
  returnUrl.search = '?spotcode_private_issues=1';
  // The identity is already linked, so linkIdentity would return
  // identity_already_exists. Re-authenticate through the same GitHub
  // identity instead; Supabase then returns a fresh provider_token
  // carrying the newly-approved repo scope.
  const { data, error } = await supa.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: returnUrl.href,
      scopes: includePrivate ? 'read:user read:org repo' : 'read:user read:org',
      queryParams: { prompt: 'consent' },
    },
  });
  if (error) throw new Error(error.message);
  return data;
}

export function linkGithubForOrganizations(redirectTo = window.location.href) {
  return linkGithubForPrivateIssues(redirectTo, false);
}

// signInWithOAuth temporarily installs the GitHub callback session as the
// active Supabase session. Capture its provider token, then restore the
// password/MFA session that was active before the redirect. This prevents a
// private-Issue permission upgrade from looking like a logout/account switch.
export async function finishPrivateIssueAuthorization() {
  if (!new URLSearchParams(location.search).has('spotcode_private_issues')) return false;
  let original = null;
  try { original = JSON.parse(sessionStorage.getItem(PRIVATE_ISSUE_SESSION_KEY) || 'null'); } catch {}
  if (!original?.access_token || !original?.refresh_token) return false;
  const supa = await getClient();
  const { data: callback } = await supa.auth.getSession();
  const providerToken = callback?.session?.provider_token || null;
  if (providerToken) {
    const { setGithubApiToken } = await import('./language-stats.js');
    setGithubApiToken(providerToken, original.user_id);
  }
  const { error } = await supa.auth.setSession({
    access_token: original.access_token,
    refresh_token: original.refresh_token,
  });
  if (error) throw new Error(error.message);
  if (providerToken) await saveSharedGithubToken(providerToken);
  try { sessionStorage.removeItem(PRIVATE_ISSUE_SESSION_KEY); } catch {}
  return !!providerToken;
}

// Idempotent post-redirect sync. Reads the current auth user's
// linked identities; if one of them is `github`, mirrors the GitHub
// username into public.profiles.github_handle and flips
// github_verified=true. Safe to call on every page boot — a no-op
// when the profile already matches.
//
// Returns { handle, avatarUrl } when a GitHub identity is present
// (whether newly written or already synced), null otherwise.
//
// Boot path: the vast majority of calls come from main.js's boot
// hook and hit the "already-synced" fast path. Do the cheapest
// possible check FIRST — the auth cache in memory — so we don't
// queue three Supabase RPCs (getUser + profiles.select +
// possibly profiles.update + refreshProfile) behind whatever
// hydrate the current view is trying to run. When the profile in
// cachedUser already has github_verified + matching handle we can
// safely no-op without ever talking to Supabase.
export async function syncGithubIdentity() {
  const cached = currentUser();
  const supa = await getClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return null;
  const gh = (user.identities || []).find((i) => i.provider === 'github');
  if (!gh) return null;
  const gd = gh.identity_data || {};
  const handle = gd.user_name || gd.preferred_username;
  if (!handle) return null;

  // Fast path: profile in memory already matches. No Supabase writes,
  // no refreshProfile (which emits and cascades a refresh() through
  // every onAuthChange subscriber — expensive during boot when a
  // hydrate is already running).
  if (cached && cached.github?.handle === handle && cached.github?.verified) {
    return { handle, avatarUrl: gd.avatar_url || null };
  }

  // Fall back to a Supabase probe (cachedUser can lag behind the DB
  // in edge cases — e.g. profile was updated on another tab).
  const { data: profile } = await supa
    .from('profiles')
    .select('github_handle, github_verified')
    .eq('id', user.id)
    .maybeSingle();
  if (profile && profile.github_handle === handle && profile.github_verified) {
    return { handle, avatarUrl: gd.avatar_url || null };
  }

  const { error } = await supa
    .from('profiles')
    .update({
      github_handle: handle,
      github_verified: true,
      // Clear the leftover column from the previous bio/repo-token
      // scheme so /settings doesn't display a stale code.
      github_verify_token: null,
    })
    .eq('id', user.id);
  if (error) throw new Error(error.message);
  // Refresh cachedUser so the topbar avatar, sidebar me-card, and
  // any open edit-profile modal all see the new github_handle /
  // verified state on next render — no page reload needed.
  await refreshProfile();
  return { handle, avatarUrl: gd.avatar_url || null };
}

// Read the GitHub access token that Supabase captured during the
// OAuth grant. Supabase exposes it as `session.provider_token`. Its
// presence lifts GitHub API rate limits from 60 req/hr (unauth) to
// 5000 req/hr, and Search API from 10 → 30 req/min — big win for
// language-stats / repos / tasks fetchers.
//
// Caveat: Supabase does NOT guarantee the provider_token survives
// token refresh. In practice it's there for the first ~1h after the
// grant, and the caller MUST tolerate a null return (fall back to
// unauthenticated calls). Getting the token again requires the user
// to re-link (linkIdentity), which is a full-page redirect — so we
// don't auto-refresh silently.
export async function getGithubToken() {
  const supa = await getClient();
  const { data } = await supa.auth.getSession();
  const ownerId = data?.session?.user?.id || '';
  const fresh = data?.session?.provider_token || null;
  if (fresh) {
    try {
      const { setGithubApiToken } = await import('./language-stats.js');
      setGithubApiToken(fresh, ownerId);
    } catch {}
    await saveSharedGithubToken(fresh).catch(() => {});
    return fresh;
  }
  // provider_token is commonly omitted after Supabase refreshes its session.
  // language-stats restores the last OAuth grant from localStorage.
  try {
    const { restoreGithubApiToken, setGithubApiToken } = await import('./language-stats.js');
    const local = restoreGithubApiToken(ownerId);
    if (local) {
      await saveSharedGithubToken(local).catch(() => {});
      return local;
    }
    const shared = await getSharedGithubToken();
    if (shared) setGithubApiToken(shared, ownerId);
    return shared;
  } catch { return null; }
}

export async function githubTokenCanReadPrivateRepos(token) {
  if (!token) return false;
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token },
    });
    if (response.status === 401) return false;
    if (!response.ok) return null;
    const scopes = String(response.headers.get('x-oauth-scopes') || '')
      .split(',').map((value) => value.trim().toLowerCase());
    return scopes.includes('repo');
  // `null` means the permission could not be checked due to a transient
  // network failure. It must not be presented as a revoked permission.
  } catch { return null; }
}

// Detach the GitHub identity from the auth user and clear the profile
// row. Two-step because unlinkIdentity is auth-service side and the
// profile row is application side; both must succeed for the user's
// UI to reliably reflect "no GitHub linked".
export async function unlinkGithub() {
  const supa = await getClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) throw new Error('ログインしてください');
  const gh = (user.identities || []).find((i) => i.provider === 'github');
  if (gh) {
    const { error } = await supa.auth.unlinkIdentity(gh);
    if (error) throw new Error(error.message);
  }
  const { error } = await supa
    .from('profiles')
    .update({ github_handle: null, github_verified: false })
    .eq('id', user.id);
  if (error) throw new Error(error.message);
  // Drop the cached API token so subsequent GitHub calls fall back
  // to anonymous — sending an unlinked user's stale token would 401
  // and eat into that token's rate-limit for no benefit.
  try {
    const ls = await import('./language-stats.js');
    ls.setGithubApiToken(null);
  } catch {}
  await refreshProfile();
}
