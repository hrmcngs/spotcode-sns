// Unified notifications inbox. One timeline aggregating every event
// addressed to the current user:
//   like / comment / repost / bookmark / quote / follow / follow_request
//
// Twitter-style 2-column row: avatar (with small action-type badge
// overlayed on its bottom-right) on the left, body text on the right.
// Pending follow requests get inline Accept / Deny buttons.

import { notificationsForMe,
         acceptFollowRequest, denyFollowRequest } from '../interactions.js';
import { currentUser }   from '../auth.js';
import { isPostingAsOfficial } from '../posting-identity.js';
import { cachedOfficialAccount, getOfficialAccount } from '../official-account.js';
import { renderAvatar }  from '../avatar.js';
import { url }           from '../router.js';
import { icon }          from '../icons.js';
import { relTime }       from '../data.js';
import { t }             from '../i18n.js';
import { maskHandle, maskName, maskMentionsInText } from '../privacy-mode.js';
import { withTimeout } from '../net-utils.js';

const notificationCache = new Map();

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// Inbox scope (per product request): like, comment, mention, follow,
// follow_request. Repost / bookmark / quote no longer surface here —
// the underlying tables still drive action counts on each post, but
// users don't want them as inbox events.
//
// Follow events target YOU (not your post), so the active "フォロー
// しました" reads ambiguously ("Alice followed [what?]"). Use the
// passive form so the recipient instantly sees this is about being
// followed. Same shape for the pending-request variant.
// Labels resolved through i18n so the same notification row reads
// "いいねしました" or "liked your post" depending on the viewer's language.
const META = {
  like:           { ico: 'heart',  mod: 'like',     labelKey: 'notif.label.like' },
  comment:        { ico: 'reply',  mod: 'comment',  labelKey: 'notif.label.comment' },
  mention:        { ico: 'at',     mod: 'mention',  labelKey: 'notif.label.mention' },
  follow:         { ico: 'user',   mod: 'follow',   labelKey: 'notif.label.follow' },
  follow_request: { ico: 'user',   mod: 'request',  labelKey: 'notif.label.follow_request' },
};

function postExcerpt(post) {
  if (!post) return '';
  const body = String(post.body || '');
  return body.length > 90 ? body.slice(0, 90) + '…' : body;
}

function renderRow(n) {
  const meta = META[n.type] || META.follow;
  const profileUrl = url('/' + n.actor.handle);
  const link = n.type === 'quote' && n.quotingPostId ? url('/post/' + n.quotingPostId)
             : n.post ? url('/post/' + n.post.id)
             : profileUrl;

  // Avatar cell — avatar circle with a small coloured badge overlayed
  // in its lower-right corner carrying the action-type icon.
  const avatarCell =
    '<div class="notif__avatar">' +
      renderAvatar(n.actor) +
      '<span class="notif__badge notif__badge--' + meta.mod + '">' +
        icon(meta.ico, { size: 12 }) +
      '</span>' +
    '</div>';

  // Title line — name + handle + action label + relative time.
  // Wrap @handle and · time so they break cleanly on narrow viewports.
  const displayName   = maskName(n.actor.handle, n.actor.name);
  const displayHandle = maskHandle(n.actor.handle);
  const title =
    '<div class="notif__title">' +
      '<span class="notif__name">' + escape(displayName) + '</span>' +
      ' <span class="notif__handle">@' + escape(displayHandle) + '</span>' +
      ' <span class="notif__action">' + escape(t(meta.labelKey)) + '</span>' +
      ' <span class="notif__time">· ' + escape(relTime(n.createdAt)) + '</span>' +
    '</div>';

  // Context line — comment / mention body, or referenced post excerpt.
  // Mentions render the mentioning text in the quote style because the
  // actor's own words are what the recipient cares about, not the post
  // they're commenting on. Bodies + excerpts route through
  // maskMentionsInText so an inline @other-user doesn't leak through.
  const context =
    (n.type === 'comment' || n.type === 'mention')
      ? '<div class="notif__quote">' + escape(maskMentionsInText(n.body || '')) + '</div>'
    : n.post
      ? '<div class="notif__post">' + escape(maskMentionsInText(postExcerpt(n.post))) + '</div>'
    : '';

  // Inline Accept / Deny for pending follow requests.
  const actions = n.type === 'follow_request'
    ? '<div class="notif__actions">' +
        '<button type="button" class="btn btn--primary btn--sm" data-notif-accept="' + escape(n.actor.handle) + '">' + t('notif.accept') + '</button>' +
        '<button type="button" class="btn btn--ghost   btn--sm" data-notif-deny="'   + escape(n.actor.handle) + '">' + t('notif.deny')   + '</button>' +
      '</div>'
    : '';

  return (
    '<a class="notif notif--' + meta.mod + '" href="' + link + '">' +
      avatarCell +
      '<div class="notif__body">' +
        title +
        context +
        actions +
      '</div>' +
    '</a>'
  );
}

export function renderNotifications() {
  // Real page header, not a fake one-item tab bar. The previous markup
  // reused .timeline__head + .tab and rendered a lone centered "通知"
  // with a blue underline, which (a) looked broken next to home's 3-tab
  // bar and (b) reserved a tall sticky strip with awkward empty space.
  return (
    '<header class="notif-head">' +
      '<h2>' + t('notif.page.title') + '</h2>' +
    '</header>' +
    '<div id="notif-list">' +
      '<div class="stub"><p class="stub__sub">' + t('notif.loading') + '</p></div>' +
    '</div>'
  );
}

export async function hydrateNotifications() {
  // Don't capture #notif-list once and write to it after the awaits —
  // a refresh() during the fetch can replace it with a fresh element,
  // and the orphan reference's innerHTML write goes nowhere (the
  // visible list stays on the loading stub). Re-resolve right before
  // every write; bail only when nothing matches (= user navigated
  // away from /notifications entirely).
  const live = () => document.getElementById('notif-list');
  if (!live()) return;

  const me = currentUser();
  if (!me) {
    const r = live();
    if (!r) return;
    r.innerHTML =
      '<div class="stub">' +
        '<h2 class="stub__title">' + t('notif.signin.title') + '</h2>' +
        '<p class="stub__sub">' + t('notif.signin.sub') + '</p>' +
        '<button class="btn btn--primary" data-auth="login">' + t('nav.login') + '</button>' +
      '</div>';
    return;
  }

  const initialCache = notificationCache.get(me.id);
  if (initialCache) paintNotifications(live(), initialCache);

  // While the "posting as official" overlay is on, show notifications
  // addressed to the brand account instead of the staffer's own —
  // the staffer is acting as the official, so their inbox should
  // reflect that. Resolve the official id (await once on cache miss).
  let targetUserId;
  if (isPostingAsOfficial()) {
    let official = cachedOfficialAccount();
    if (!official) { try { official = await getOfficialAccount(); } catch {} }
    if (official) targetUserId = official.id;
  }

  let items;
  try { items = await withTimeout(notificationsForMe({ targetUserId }), 12000, 'notifications'); }
  catch (err) {
    const r = live();
    if (!r) return;
    if (initialCache) return; // a refresh failure must not erase cached rows
    r.innerHTML =
      '<div class="stub">' +
        '<h2 class="stub__title">' + t('notif.error.title') + '</h2>' +
        '<p class="stub__sub">' + escape(err.message || '') + '</p>' +
        '<button class="btn btn--ghost btn--sm" data-notif-retry="1">再試行</button>' +
      '</div>';
    return;
  }
  const r = live();
  if (!r) return;

  notificationCache.set(targetUserId || me.id, items);
  paintNotifications(r, items);
}

function paintNotifications(r, items) {
  if (!r) return;
  if (!items.length) {
    r.innerHTML =
      '<div class="stub">' +
        '<h2 class="stub__title">' + t('notif.empty.title') + '</h2>' +
        '<p class="stub__sub">' + t('notif.empty.sub') + '</p>' +
      '</div>';
    return;
  }
  r.innerHTML = items.map(renderRow).join('');
}

// Click delegation for Accept / Deny on inline follow-request rows.
// MUST stay synchronous — main.js uses
//   if (handleNotifAction(e)) return;
// to early-out when this handler took the event. An `async function`
// returns a Promise (always truthy), which would unconditionally
// short-circuit every later click handler (Edit profile, Like,
// Report, Delete, …). Do the actual network work fire-and-forget.
export function handleNotifAction(e) {
  // Retry button on the error stub — re-runs hydration without a
  // full route re-dispatch (which would tear down / re-add the list).
  const retry = e.target.closest('[data-notif-retry]');
  if (retry) {
    e.preventDefault();
    const list = document.getElementById('notif-list');
    if (list) list.innerHTML = '<div class="stub"><p class="stub__sub">' + t('notif.loading') + '</p></div>';
    hydrateNotifications();
    return true;
  }
  const accept = e.target.closest('[data-notif-accept]');
  const deny   = e.target.closest('[data-notif-deny]');
  if (!accept && !deny) return false;
  e.preventDefault();
  e.stopPropagation(); // don't trigger the outer <a class="notif"> link
  const handle = (accept || deny).getAttribute(accept ? 'data-notif-accept' : 'data-notif-deny');
  if (!handle) return true;
  const fn = accept ? acceptFollowRequest : denyFollowRequest;
  fn(handle)
    .then(() => hydrateNotifications())
    .catch((err) => alert((accept ? '承認' : '拒否') + 'に失敗しました: ' + err.message));
  return true;
}
