const SUPABASE_URL = requireEnv('SUPABASE_URL').replace(/\/$/, '');
const SUPABASE_ANON_KEY = requireEnv('SUPABASE_ANON_KEY');
const DEV_ACCOUNT_PASSWORD = requireEnv('DEV_ACCOUNT_PASSWORD');

const DEV_ACCOUNT_EMAIL = 'dev.test.account@spotcode-sns.local';
const AUTO_POST_PREFIX = '[spotcode自動投稿] Supabase稼働確認';

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function supabaseRequest(path, { accessToken, method = 'GET', body } = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      Prefer: 'return=representation',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const detail = data?.message || data?.error_description || text || response.statusText;
    throw new Error(`${method} ${path} failed (${response.status}): ${detail}`);
  }
  return data;
}

const session = await supabaseRequest('/auth/v1/token?grant_type=password', {
  method: 'POST',
  body: { email: DEV_ACCOUNT_EMAIL, password: DEV_ACCOUNT_PASSWORD },
});

if (!session.access_token || !session.user?.id) {
  throw new Error('Supabase login succeeded but did not return a user session');
}

const createdAt = new Date().toISOString();
const inserted = await supabaseRequest('/rest/v1/posts?select=id', {
  accessToken: session.access_token,
  method: 'POST',
  body: {
    author_id: session.user.id,
    body: `${AUTO_POST_PREFIX}\n${createdAt}`,
    status: 'active',
  },
});

const newPostId = inserted?.[0]?.id;
if (!newPostId) throw new Error('Post insert succeeded but did not return an id');

// Insert first so a transient insert failure never removes the last keep-alive post.
// The prefix limits cleanup to posts created by this automation; ordinary posts made
// with the dev account are left untouched.
const cleanupQuery = new URLSearchParams({
  author_id: `eq.${session.user.id}`,
  id: `neq.${newPostId}`,
  body: `like.${AUTO_POST_PREFIX}*`,
  select: 'id',
});
const deleted = await supabaseRequest(`/rest/v1/posts?${cleanupQuery}`, {
  accessToken: session.access_token,
  method: 'DELETE',
});

console.log(`Created automatic post ${newPostId}; deleted ${deleted?.length || 0} previous automatic post(s).`);
