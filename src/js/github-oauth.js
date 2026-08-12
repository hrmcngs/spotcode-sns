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

// Kick off the link flow. Supabase-js redirects the browser to
// github.com's consent page; when the user approves, GitHub bounces
// them to the Supabase project's /auth/v1/callback, and Supabase
// finally sends them back to `redirectTo` with a session tacked onto
// the URL fragment. The default `redirectTo` is the current URL so
// the user lands right back where they were (the edit-profile modal).
//
// Scope: `read:user` gets us `user_name` + `avatar_url` and nothing
// else. We intentionally do NOT request `repo` — this is an identity
// link, not a permission grant, and asking for more read access would
// scare users off the consent screen for no gain.
export async function linkGithub(redirectTo = window.location.href) {
  const supa = await getClient();
  const { data, error } = await supa.auth.linkIdentity({
    provider: 'github',
    options: { redirectTo, scopes: 'read:user' },
  });
  if (error) throw new Error(error.message);
  return data;
}

// Explicit opt-in for private issue display. GitHub's classic OAuth
// scopes do not offer a narrower read-only private-issues permission;
// `repo` is therefore requested only after the user enables this feature.
export async function linkGithubForPrivateIssues(redirectTo = window.location.href) {
  const supa = await getClient();
  const { data, error } = await supa.auth.linkIdentity({
    provider: 'github',
    options: { redirectTo, scopes: 'read:user repo' },
  });
  if (error) throw new Error(error.message);
  return data;
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
  return data?.session?.provider_token || null;
}

export async function githubTokenCanReadPrivateRepos(token) {
  if (!token) return false;
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token },
    });
    if (!response.ok) return false;
    const scopes = String(response.headers.get('x-oauth-scopes') || '')
      .split(',').map((value) => value.trim().toLowerCase());
    return scopes.includes('repo');
  } catch { return false; }
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
