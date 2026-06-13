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

// Build the unique repo name the user must create on GitHub to prove
// ownership. Kept short and obviously meaningless so leaving it on the
// account doesn't read like a real project.
export function repoNameFor(token) { return token; /* spotcode-verify-<hex> */ }

// Convenience: deep-link the user to GitHub's "new repo" page with the
// name + description prefilled — one click → already-filled-in form.
export function newRepoUrl(token) {
  const params = new URLSearchParams({
    name: repoNameFor(token),
    description: 'spotcode-sns 本人確認用（確認後に削除して OK）',
    visibility: 'public',
  });
  return 'https://github.com/new?' + params.toString();
}

// Hit the public GitHub API to see whether <handle>/<repoName> exists.
// 200 → true, 404 → false, anything else → error.
async function repoExists(handle, repoName) {
  const buster = '_' + Date.now() + Math.random().toString(36).slice(2, 8);
  const url = 'https://api.github.com/repos/'
    + encodeURIComponent(handle) + '/' + encodeURIComponent(repoName) + '?cb=' + buster;
  const r = await fetch(url, {
    cache: 'no-store',
    headers: { 'Accept': 'application/vnd.github+json' },
  });
  if (r.status === 200) return true;
  if (r.status === 404) return false;
  throw new Error('GitHub API ' + r.status);
}

// Check that the user created the repo we asked them to. If yes, flip
// github_verified to true. Returns the new state.
export async function confirmVerification(handle, token) {
  if (!handle || !token) throw new Error('invalid');
  const repoName = repoNameFor(token);
  // Three quick tries — newly-created repos may take a moment to appear
  // in the REST API.
  let exists = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { exists = await repoExists(handle, repoName); }
    catch (err) {
      if (attempt === 3) throw new Error('GitHub API 取得失敗: ' + err.message);
      await new Promise(r => setTimeout(r, 1500));
      continue;
    }
    if (exists) break;
    if (attempt < 3) await new Promise(r => setTimeout(r, 1500));
  }
  if (!exists) {
    throw new Error(
      '@' + handle + '/' + repoName + ' が見つかりませんでした。' +
      '上のリンクから空の public リポジトリを作って、もう一度押してください。'
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
