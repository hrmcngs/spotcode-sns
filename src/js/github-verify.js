// Lightweight "are you really this GitHub user?" check.
//
// No backend OAuth (we'd need a client_secret which can't live in a
// static site), so we use the bio-token pattern: the app gives the
// claimant a random token to paste into their public GitHub bio, then
// reads the bio via the public REST API and compares.
//
// Persists `github_verified` + `github_verify_token` on the profile so
// the badge survives across devices.

import { getClient } from './supa.js';

export function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return 'spotcode-verify-' + [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Write a fresh token to the current user's profile. Returns the token.
// Always replaces the previous one so a verification attempt that
// stalled doesn't strand the user with an old code they already deleted.
export async function startVerification() {
  const supa = await getClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) throw new Error('ログインしてください');
  const token = generateToken();
  const { error } = await supa.from('profiles')
    .update({ github_verify_token: token, github_verified: false })
    .eq('id', user.id);
  if (error) throw new Error(error.message);
  return token;
}

// Read the GitHub user's public bio and check it contains the saved
// token. If yes, flip github_verified to true. Returns the new state.
export async function confirmVerification(handle, token) {
  if (!handle || !token) throw new Error('invalid');
  let bio = '';
  try {
    const r = await fetch('https://api.github.com/users/' + encodeURIComponent(handle), {
      headers: { 'Accept': 'application/vnd.github+json' },
    });
    if (!r.ok) throw new Error('GitHub API ' + r.status);
    const j = await r.json();
    bio = j.bio || '';
  } catch (err) { throw new Error('GitHub プロフィール取得失敗: ' + err.message); }
  const ok = bio.includes(token);
  if (!ok) throw new Error('GitHub bio に「' + token + '」が見つかりませんでした');

  const supa = await getClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) throw new Error('ログインしてください');
  const { error } = await supa.from('profiles')
    .update({ github_verified: true, github_verify_token: null })
    .eq('id', user.id);
  if (error) throw new Error(error.message);
  return true;
}
