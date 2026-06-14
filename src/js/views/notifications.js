// Unified notifications inbox. One timeline aggregating every event
// addressed to the current user:
//   like / comment / repost / bookmark / quote / follow / follow_request
// Pending follow requests get inline Accept / Deny buttons (the old
// /requests page is still reachable for users who bookmarked it).

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

const META = {
  like:           { ico: 'heart',  className: 'notif--like',     label: 'いいねしました' },
  comment:        { ico: 'reply',  className: 'notif--comment',  label: 'コメントしました' },
  repost:         { ico: 'fork',   className: 'notif--repost',   label: 'リポストしました' },
  bookmark:       { ico: 'star',   className: 'notif--bookmark', label: '保存しました' },
  quote:          { ico: 'chart',  className: 'notif--quote',    label: '引用しました' },
  follow:         { ico: 'user',   className: 'notif--follow',   label: 'フォローしました' },
  follow_request: { ico: 'user',   className: 'notif--request',  label: 'フォローをリクエストしました' },
};

function postExcerpt(post) {
  if (!post) return '';
  const body = String(post.body || '');
  return body.length > 80 ? body.slice(0, 80) + '…' : body;
}

function renderRow(n) {
  const meta = META[n.type] || META.follow;
  const profileUrl = url('/' + n.actor.handle);
  const link = n.type === 'quote' && n.quotingPostId ? url('/post/' + n.quotingPostId)
             : n.post ? url('/post/' + n.post.id)
             : profileUrl;

  const headLine =
    '<a class="notif-row__name" href="' + profileUrl + '">' + escape(n.actor.name) + '</a>' +
    ' <span class="notif-row__handle">@' + escape(n.actor.handle) + '</span>' +
    ' <span class="notif-row__action">' + escape(meta.label) + '</span>' +
    ' <span class="notif-row__time">· ' + escape(relTime(n.createdAt)) + '</span>';

  const contextLine =
    n.type === 'comment'   ? '<div class="notif-row__quote">' + escape(n.body || '') + '</div>'
  : n.type === 'quote'     ? '<div class="notif-row__quote">' + escape(n.body || '') + '</div>'
  : n.post                 ? '<div class="notif-row__post">' + escape(postExcerpt(n.post)) + '</div>'
  : '';

  const actions = n.type === 'follow_request'
    ? '<div class="notif-row__actions">' +
        '<button class="btn btn--primary btn--sm" data-notif-accept="' + escape(n.actor.handle) + '">承認</button>' +
        '<button class="btn btn--ghost btn--sm" data-notif-deny="' + escape(n.actor.handle) + '">拒否</button>' +
      '</div>'
    : '';

  return (
    '<a class="notif-row ' + meta.className + '" href="' + link + '">' +
      '<div class="notif-row__ico">' + icon(meta.ico, { size: 18 }) + '</div>' +
      '<div class="notif-row__avatar">' + renderAvatar(n.actor) + '</div>' +
      '<div class="notif-row__body">' +
        '<div class="notif-row__head">' + headLine + '</div>' +
        contextLine +
        actions +
      '</div>' +
    '</a>'
  );
}

export function renderNotifications() {
  renderVersion++;
  return (
    '<div class="timeline__head">' +
      '<span class="tab is-active">通知</span>' +
    '</div>' +
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
        '<p class="stub__sub">いいね / コメント / リポスト / 保存 / 引用 / フォロー があるとここに集まります。</p>' +
      '</div>';
    return;
  }
  root.innerHTML = items.map(renderRow).join('');
}

// Click delegation for Accept / Deny on inline follow-request rows.
// Re-fetches the list after a state change so the row disappears (deny)
// or upgrades to a plain "follow" entry (accept).
export async function handleNotifAction(e) {
  const accept = e.target.closest('[data-notif-accept]');
  const deny   = e.target.closest('[data-notif-deny]');
  if (!accept && !deny) return false;
  e.preventDefault();
  const handle = (accept || deny).getAttribute(accept ? 'data-notif-accept' : 'data-notif-deny');
  if (!handle) return true;
  const fn = accept ? acceptFollowRequest : denyFollowRequest;
  try {
    await fn(handle);
    await hydrateNotifications();
  } catch (err) {
    alert((accept ? '承認' : '拒否') + 'に失敗しました: ' + err.message);
  }
  return true;
}
