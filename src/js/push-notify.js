// Browser Notifications API wrapper — the OS-level "push" surface
// for spotcode-sns. Only fires when the user has BOTH granted the
// browser permission AND flipped the /settings opt-in. Triggers:
//
//   • notif-poller.js     — likes / comments / reposts / mentions /
//                           follows / follow_requests on the auth user
//   • nearby-spot-watcher — geolocation comes within range of a
//                           spot-tagged post
//
// Why no Service Worker / VAPID push: the user explicitly chose the
// "tab open only" tier in the planning question. That dropped the
// whole subscription / Edge Function / push-service stack and made
// this a single-file frontend concern. Upgrading later wouldn't
// invalidate the existing call sites — `showPush()` is the public
// surface for any path that wants to fire a notification.

const PREF_KEY = 'spotcode:push-notify';

// User-facing opt-in stored in localStorage so the choice survives
// reloads. Independent from the browser's own `Notification.permission`
// — both have to be true for `canPush()` to fire.
export function isPushEnabled() {
  try { return localStorage.getItem(PREF_KEY) === '1'; }
  catch { return false; }
}

export function setPushEnabled(on) {
  try {
    if (on) localStorage.setItem(PREF_KEY, '1');
    else    localStorage.removeItem(PREF_KEY);
  } catch {}
  listeners.forEach((fn) => { try { fn(!!on); } catch {} });
}

const listeners = new Set();
export function onPushPrefChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// 'unsupported' | 'default' | 'granted' | 'denied'.
// 'unsupported' covers iOS Safari < 16.4 (no Notification global)
// and Electron's headless renderer paths.
export function browserPermissionState() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

// One-shot permission ask. Resolves with the new permission state.
// Safe to call when already granted (returns 'granted' synchronously
// via the promise) or denied (returns 'denied' — the browser won't
// re-prompt after a denial and silently resolves with that).
export async function requestBrowserPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied')  return 'denied';
  try { return await Notification.requestPermission(); }
  catch { return Notification.permission; }
}

// Composite gate. True iff the browser permits + the user opted in.
export function canPush() {
  return typeof Notification !== 'undefined'
    && Notification.permission === 'granted'
    && isPushEnabled();
}

// Fire an OS notification.
//
//   showPush('@aya がいいねしました', { body: '...', tag: 'like:abc', url: '/post/abc' })
//
// `tag` collapses duplicates (same tag → previous banner is replaced
// instead of stacked). `url` opens the SPA at that path when the user
// clicks the banner. `skipIfVisible` suppresses the banner when the
// tab is already focused — handy for triggers that already show an
// inline indicator (so the user doesn't see double).
export function showPush(title, options = {}) {
  if (!canPush()) return null;
  if (options.skipIfVisible && document.visibilityState === 'visible') return null;
  const { url, skipIfVisible: _skip, ...nativeOptions } = options;
  try {
    const icon = (window.__BASE__ || '/') + 'favicon.svg';
    const n = new Notification(title, {
      icon,
      badge: icon,
      ...nativeOptions,
    });
    if (url) {
      n.onclick = () => {
        try { window.focus(); } catch {}
        try { location.href = url; } catch {}
        try { n.close(); } catch {}
      };
    }
    return n;
  } catch {
    return null;
  }
}
