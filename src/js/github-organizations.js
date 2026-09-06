import { currentUser } from './auth.js';
import { getClient } from './supa.js';
import { getGithubToken } from './github-oauth.js';

let snapshot = null;
export function canReadGithubOrganization(orgId) {
  return !!snapshot && snapshot.owner === currentUser()?.id && snapshot.expires > Date.now()
    && snapshot.organizations.some(org => String(org.id) === String(orgId));
}

export async function syncGithubOrganizations(options = {}) {
  const owner = currentUser()?.id;
  if (!owner) throw new Error('ログインしてください');
  const token = await getGithubToken();
  if (!token) throw new Error('GitHub Organizationを連携してください');
  const client = await getClient();
  const { data, error } = await client.functions.invoke('github-organizations', { body: { ...options, github_token: token } });
  if (error || data?.error) {
    let message = data?.error || error?.message;
    try { message = (await error.context.json()).error || message; } catch {}
    throw new Error(message || 'Organizationの確認に失敗しました');
  }
  if (currentUser()?.id !== owner) throw new Error('アカウントが変更されました');
  snapshot = { owner, organizations: data.organizations || [], expires: Date.now() + 55 * 60 * 1000 };
  return data;
}

let attemptOwner = null;
let attemptedAt = 0;
let inFlight = null;
export async function refreshGithubMembershipsIfNeeded({ required = false } = {}) {
  const owner = currentUser()?.id;
  if (!owner || (snapshot?.owner === owner && snapshot.expires > Date.now())) return;
  // A write must surface verification failures instead of silently using a personal identity.
  if (required) return syncGithubOrganizations();
  if (inFlight && attemptOwner === owner) return inFlight;
  if (attemptOwner === owner && Date.now() - attemptedAt < 60000) return;
  attemptOwner = owner;
  attemptedAt = Date.now();
  const pending = syncGithubOrganizations().catch(() => {});
  inFlight = pending;
  try { await pending; } finally { if (inFlight === pending) inFlight = null; }
}
