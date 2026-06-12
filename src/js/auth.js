// Auth: register, login, logout, current session.
// Demo-grade — passwords are SHA-256(salt:password) in localStorage.
// Swap this module to call a real backend later; keep the function shapes.

import { KEYS, read, write, remove, hashPassword, randomSalt } from './storage.js';

const subscribers = new Set();
function emit() { subscribers.forEach(fn => fn(currentUser())); }
export function onAuthChange(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }

export function currentUser() {
  const handle = read(KEYS.session, null);
  if (!handle) return null;
  const users = read(KEYS.users, {});
  return users[handle] || null;
}

// Validate a GitHub handle by hitting the unauthenticated public API.
// Returns the API user object on success, null on failure.
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
function handleLooksValid(h) { return /^[A-Za-z0-9_]{2,20}$/.test(h); }

export async function register({ email, password, handle, name, role, githubHandle }) {
  if (!emailLooksValid(email))      throw new Error('メールアドレスの形式が正しくありません');
  if (!password || password.length < 8) throw new Error('パスワードは 8 文字以上にしてください');
  if (!handleLooksValid(handle))    throw new Error('ハンドルは半角英数_の 2〜20 文字');
  if (!name || !name.trim())        throw new Error('表示名を入力してください');
  if (role === 'programmer' && !githubHandle) {
    throw new Error('Programmer ロールは GitHub 連携が必須です');
  }

  const users = read(KEYS.users, {});
  if (users[handle]) throw new Error('そのハンドルは既に使われています');
  if (Object.values(users).some(u => u.email === email)) throw new Error('そのメールは既に登録されています');

  let github = null;
  if (githubHandle) {
    const profile = await fetchGithubProfile(githubHandle);
    if (!profile) throw new Error('GitHub ユーザー「' + githubHandle + '」が見つかりませんでした');
    github = {
      handle: profile.login,
      url: profile.html_url,
      avatar: profile.avatar_url,
      bio: profile.bio || '',
    };
  }

  const salt = randomSalt();
  const passwordHash = await hashPassword(password, salt);
  const user = {
    handle,
    name: name.trim(),
    avatar: (name.trim()[0] || handle[0] || '?').toUpperCase(),
    email,
    salt,
    passwordHash,
    role,
    github,
    bio: github?.bio || '',
    location: '',
    joined: new Date().toISOString().slice(0, 7),
    following: 0,
    followers: 0,
    createdAt: Date.now(),
  };
  users[handle] = user;
  write(KEYS.users, users);
  write(KEYS.session, handle);
  emit();
  return user;
}

export async function login({ email, password }) {
  const users = read(KEYS.users, {});
  const u = Object.values(users).find(x => x.email === email);
  if (!u) throw new Error('このメールのアカウントはありません');
  const h = await hashPassword(password, u.salt);
  if (h !== u.passwordHash) throw new Error('パスワードが違います');
  write(KEYS.session, u.handle);
  emit();
  return u;
}

export function logout() {
  remove(KEYS.session);
  emit();
}
