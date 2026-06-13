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

async function fetchGithubBio(handle) {
  // Bust the GitHub CDN cache — bio changes propagate via a ~60 second
  // edge TTL, so the user who pasted their token and immediately hit
  // Verify would otherwise still see an empty bio. A unique query
  // parameter changes the cache key.
  const buster = '_' + Date.now() + Math.random().toString(36).slice(2, 8);
  const r = await fetch(
    'https://api.github.com/users/' + encodeURIComponent(handle) + '?cb=' + buster,
    { cache: 'no-store', headers: { 'Accept': 'application/vnd.github+json' } }
  );
  if (!r.ok) throw new Error('GitHub API ' + r.status);
  const j = await r.json();
  return j.bio || '';
}

// Read the GitHub user's public bio and check it contains the saved
// token. If yes, flip github_verified to true. Returns the new state.
export async function confirmVerification(handle, token) {
  if (!handle || !token) throw new Error('invalid');
  // Try up to 3 times with a short wait between attempts — even with
  // the cache-buster query, the edge node we hit may still serve a
  // stale entry for a few seconds after the bio was just saved.
  let bio = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { bio = await fetchGithubBio(handle); }
    catch (err) {
      if (attempt === 3) throw new Error('GitHub プロフィール取得失敗: ' + err.message);
      await new Promise(r => setTimeout(r, 1500));
      continue;
    }
    if (bio.includes(token)) break;
    if (attempt < 3) await new Promise(r => setTimeout(r, 1500));
  }
  if (!bio.includes(token)) {
    throw new Error(
      'GitHub bio に「' + token +
      '」が見つかりませんでした。Bio を保存した直後はキャッシュで反映が遅れることがあります。30 秒ほど待ってもう一度押してください。'
    );
  }

  const supa = await getClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) throw new Error('ログインしてください');
  const { error } = await supa.from('profiles')
    .update({ github_verified: true, github_verify_token: null })
    .eq('id', user.id);
  if (error) throw new Error(error.message);
  return true;
}
