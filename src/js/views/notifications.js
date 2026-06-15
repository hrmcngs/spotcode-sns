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
import { renderAvatar }  from '../avatar.js';
import { url }           from '../router.js';
import { icon }          from '../icons.js';
import { relTime }       from '../data.js';

let renderVersion = 0;

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
const META = {
  like:           { ico: 'heart',  mod: 'like',     label: 'いいねしました' },
  comment:        { ico: 'reply',  mod: 'comment',  label: 'コメントしました' },
  mention:        { ico: 'at',     mod: 'mention',  label: 'メンションされました' },
  follow:         { ico: 'user',   mod: 'follow',   label: 'フォローされました' },
  follow_request: { ico: 'user',   mod: 'request',  label: 'フォローリクエストされました' },
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
  const title =
    '<div class="notif__title">' +
      '<span class="notif__name">' + escape(n.actor.name) + '</span>' +
      ' <span class="notif__handle">@' + escape(n.actor.handle) + '</span>' +
      ' <span class="notif__action">' + escape(meta.label) + '</span>' +
      ' <span class="notif__time">· ' + escape(relTime(n.createdAt)) + '</span>' +
    '</div>';

  // Context line — comment / mention body, or referenced post excerpt.
  // Mentions render the mentioning text in the quote style because the
  // actor's own words are what the recipient cares about, not the post
  // they're commenting on.
  const context =
    (n.type === 'comment' || n.type === 'mention')
      ? '<div class="notif__quote">' + escape(n.body || '') + '</div>'
    : n.post
      ? '<div class="notif__post">' + escape(postExcerpt(n.post)) + '</div>'
    : '';

  // Inline Accept / Deny for pending follow requests.
  const actions = n.type === 'follow_request'
    ? '<div class="notif__actions">' +
        '<button type="button" class="btn btn--primary btn--sm" data-notif-accept="' + escape(n.actor.handle) + '">承認</button>' +
        '<button type="button" class="btn btn--ghost   btn--sm" data-notif-deny="'   + escape(n.actor.handle) + '">拒否</button>' +
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
  renderVersion++;
  // Real page header, not a fake one-item tab bar. The previous markup
  // reused .timeline__head + .tab and rendered a lone centered "通知"
  // with a blue underline, which (a) looked broken next to home's 3-tab
  // bar and (b) reserved a tall sticky strip with awkward empty space.
  return (
    '<header class="notif-head">' +
      '<h2>通知</h2>' +
    '</header>' +
    '<div id="notif-list">' +
      '<div class="stub"><p class="stub__sub">読み込み中…</p></div>' +
    '</div>'
  );
}

export async function hydrateNotifications() {
  const myVersion = renderVersion;
  const root = document.getElementById('notif-list');
  if (!root) return;

  const me = currentUser();
  if (!me) {
    root.innerHTML =
      '<div class="stub">' +
        '<h2 class="stub__title">サインインしてください</h2>' +
        '<p class="stub__sub">通知はサインインしたユーザー宛のものを表示します。</p>' +
        '<button class="btn btn--primary" data-auth="login">Log in</button>' +
      '</div>';
    return;
  }

  let items;
  try { items = await notificationsForMe(); }
  catch (err) {
    if (myVersion !== renderVersion) return;
    root.innerHTML = '<div class="stub"><h2 class="stub__title">読み込み失敗</h2><p class="stub__sub">' + escape(err.message || '') + '</p></div>';
    return;
  }
  if (myVersion !== renderVersion) return;

  if (!items.length) {
    root.innerHTML =
      '<div class="stub">' +
        '<h2 class="stub__title">まだ通知はありません</h2>' +
        '<p class="stub__sub">いいね / コメント / リポスト / 保存 / 引用 / フォロー / リクエスト があるとここに集まります。</p>' +
      '</div>';
    return;
  }
  root.innerHTML = items.map(renderRow).join('');
}

// Click delegation for Accept / Deny on inline follow-request rows.
// MUST stay synchronous — main.js uses
//   if (handleNotifAction(e)) return;
// to early-out when this handler took the event. An `async function`
// returns a Promise (always truthy), which would unconditionally
// short-circuit every later click handler (Edit profile, Like,
// Report, Delete, …). Do the actual network work fire-and-forget.
export function handleNotifAction(e) {
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
