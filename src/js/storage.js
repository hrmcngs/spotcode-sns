// Thin localStorage wrappers + a password hash helper.
// All persistence in this app currently lives in the browser; swap the
// implementation here when a backend is wired up.

export const KEYS = {
  users:    'spotcode:users',
  posts:    'spotcode:posts',
  session:  'spotcode:session',
  supaUrl:  'spotcode:supa_url',
  supaAnon: 'spotcode:supa_anon',
  lang:     'spotcode:lang',
};

// Per-key memo of the parsed value. The users map carries base64
// avatar images (tens of KB per user), and read() gets called per
// post render for author lookups — re-JSON.parse-ing a potentially
// multi-hundred-KB blob dozens of times per paint was a real CPU cost
// on mobile. All writers of these keys go through write()/remove()
// below, which keep the memo coherent. (Cross-tab writes won't be
// picked up until reload — same behavior localStorage reads had in
// practice, since callers cache results themselves anyway.)
const memo = new Map();

export function read(key, fallback) {
  if (memo.has(key)) return memo.get(key);
  let v;
  try {
    const raw = localStorage.getItem(key);
    v = raw == null ? fallback : JSON.parse(raw);
  } catch { v = fallback; }
  memo.set(key, v);
  return v;
}

export function write(key, value) {
  memo.set(key, value);
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export function remove(key) {
  memo.delete(key);
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
