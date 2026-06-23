// Periodic poll of the (synthetic) notifications inbox. Diffs against
// the last-seen timestamp persisted in localStorage so a returning
// user only gets banners for activity AFTER their last poll, not the
// entire backlog. Wraps `notificationsForMe()` from interactions.js
// — same source the /notifications view reads — so the OS-level
// banner content matches the inbox exactly.
//
// Why polling (and not Supabase Realtime subscriptions): the inbox is
// stitched together client-side from FOUR tables (likes, comments,
// posts (mentions), follows). A realtime channel per table would
// each fire on every row everywhere and need server-side filters
// keyed to the auth user's posts / handle — re-subscribing every
// time the user posts. Polling every 60s while the tab is visible
// covers the same UX with a fraction of the moving parts.
//
// The poll is OFF when the tab is hidden (we can't show OS banners
// in the background anyway for tab-only push), keyed off the page
// visibility API to save battery. visibilitychange resumes it.

import { notificationsForMe } from './interactions.js';
import { canPush, showPush } from './push-notify.js';
import { currentUser } from './auth.js';
import { isPostingAsOfficial } from './posting-identity.js';
import { getOfficialAccount } from './official-account.js';

const POLL_INTERVAL_MS = 60 * 1000;
const LAST_SEEN_KEY = 'spotcode:push-notify-last-seen';

let pollTimer = null;
let stopped = false;

// Round trip dedupe: a fast first poll right after the auth user
// changes shouldn't fire dozens of historical banners. The very first
// poll for a fresh session seeds `lastSeen` to "now" — only events
// that arrive AFTER that point get notified.
let seeded = false;

function lastSeen() {
  try { return Number(localStorage.getItem(LAST_SEEN_KEY)) || 0; }
  catch { return 0; }
}
function setLastSeen(ts) {
  try { localStorage.setItem(LAST_SEEN_KEY, String(ts)); }
  catch {}
}

// Map notif type → OS-banner title. Body is the post excerpt /
// comment text where applicable, capped so long ones don't blow up
// the banner. Click-through URL: post detail for engagement notifs,
// profile for follow notifs (so the user can reciprocate / approve).
function formatNotif(n) {
  const actorHandle = n.actor?.handle || '?';
  const actorName   = n.actor?.name || ('@' + actorHandle);
  const postExcerpt = (n.post?.body || n.body || '').slice(0, 80);
  const base = (window.__BASE__ || '/');
  switch (n.type) {
    case 'like':
      return {
        title: actorName + 'さんがいいねしました',
        body:  postExcerpt,
        tag:   'like:' + (n.post?.id || actorHandle),
        url:   n.post?.id ? base + 'post/' + n.post.id : base + actorHandle,
      };
    case 'comment':
      return {
        title: actorName + 'さんがコメントしました',
        body:  postExcerpt,
        tag:   'comment:' + (n.post?.id || actorHandle) + ':' + n.createdAt,
        url:   n.post?.id ? base + 'post/' + n.post.id : base,
      };
    case 'mention':
      return {
        title: actorName + 'さんがあなたをメンションしました',
        body:  postExcerpt,
        tag:   'mention:' + (n.post?.id || actorHandle) + ':' + n.createdAt,
        url:   n.post?.id ? base + 'post/' + n.post.id : base,
      };
    case 'follow':
      return {
        title: actorName + 'さんにフォローされました',
        body:  '@' + actorHandle,
        tag:   'follow:' + actorHandle,
        url:   base + actorHandle,
      };
    case 'follow_request':
      return {
        title: actorName + 'さんからフォローリクエスト',
        body:  '@' + actorHandle,
        tag:   'follow_request:' + actorHandle,
        url:   base + 'notifications',
      };
    default:
      return null;
  }
}

async function effectiveAuthId() {
  const me = currentUser();
  if (!me) return null;
  // Overlay flips the EFFECTIVE author for posts; for notifications
  // the user almost certainly wants to see the BRAND's inbox while
  // they're "posting as" it. Same substitution notif view + auth
  // helpers already do.
  if (isPostingAsOfficial()) {
    try {
      const acct = await getOfficialAccount();
      if (acct?.id) return acct.id;
    } catch {}
  }
  return me.id;
}

async function tick() {
  if (stopped) return;
  if (!canPush()) return;        // user disabled / permission lost
  if (!currentUser()) return;    // no auth
  if (document.visibilityState !== 'visible') return; // tab hidden
  let targetUserId;
  try { targetUserId = await effectiveAuthId(); } catch { return; }
  if (!targetUserId) return;

  let items;
  try { items = await notificationsForMe({ limit: 40, targetUserId }); }
  catch (err) { console.warn('notif-poller fetch', err); return; }
  if (!items || !items.length) return;

  // Sort newest-first for the banner-firing pass so the most recent
  // event wins when multiple share a tag.
  items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const previous = lastSeen();
  const now = Date.now();

  if (!seeded) {
    // First poll after the page boots — establish a watermark at the
    // newest item we already see so we don't fire backlog banners.
    seeded = true;
    setLastSeen(Math.max(previous, items[0].createdAt || now));
    return;
  }

  const fresh = items.filter((n) => (n.createdAt || 0) > previous);
  if (!fresh.length) return;

  // Cap the burst — if 50 follows landed at once we don't want 50
  // banners to chain. The inbox is one click away.
  const MAX_BURST = 5;
  for (const n of fresh.slice(0, MAX_BURST)) {
    const formatted = formatNotif(n);
    if (!formatted) continue;
    showPush(formatted.title, {
      body: formatted.body,
      tag:  formatted.tag,
      url:  formatted.url,
      // The /notifications view already shows the row in-page; if the
      // user is looking at the tab we don't need the OS banner too.
      skipIfVisible: true,
    });
  }
  if (fresh.length > MAX_BURST) {
    showPush('+' + (fresh.length - MAX_BURST) + ' 件の新着通知', {
      tag: 'notif-summary',
      url: (window.__BASE__ || '/') + 'notifications',
      skipIfVisible: true,
    });
  }
  setLastSeen(Math.max(...fresh.map((n) => n.createdAt || 0), previous));
}

export function startNotifPoller() {
  if (pollTimer) return;
  stopped = false;
  // First tick on next macrotask so the import doesn't block page boot.
  setTimeout(() => { tick().catch(() => {}); }, 1500);
  pollTimer = setInterval(() => { tick().catch(() => {}); }, POLL_INTERVAL_MS);
  // Catch up immediately when the tab comes back to focus so the
  // user doesn't wait up to a minute after un-hiding.
  document.addEventListener('visibilitychange', visibilityKick);
}

export function stopNotifPoller() {
  stopped = true;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  document.removeEventListener('visibilitychange', visibilityKick);
}

function visibilityKick() {
  if (document.visibilityState === 'visible') {
    tick().catch(() => {});
  }
}

// Reset the dedupe watermark — called when the auth user switches so
// the next poll establishes a fresh "now" baseline instead of
// firing a backlog of the new user's old notifications.
export function resetNotifPollerSeed() {
  seeded = false;
}
