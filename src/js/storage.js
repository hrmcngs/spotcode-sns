// Thin localStorage wrappers + a password hash helper.
// All persistence in this app currently lives in the browser; swap the
// implementation here when a backend is wired up.

export const KEYS = {
  users:    'spotcode:users',
  posts:    'spotcode:posts',
  session:  'spotcode:session',
  supaUrl:  'spotcode:supa_url',
  supaAnon: 'spotcode:supa_anon',
};

export function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}

export function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export function remove(key) {
  try { localStorage.removeItem(key); } catch {}
}

// SHA-256(salt + ":" + password). Client-side hashing is decorative without
// a backend, but it avoids storing plaintext in localStorage at least.
export async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(salt + ':' + password);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function randomSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
