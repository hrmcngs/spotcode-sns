// Per-post analytics dashboard, visible only to the post author.
// Route: /post/<id>/analytics
//
// Shows totals + the list of who did each action. Right now (PR A) that
// is: likes (with actor list) + comments (with author list). PR B will
// add reposts / quotes / bookmarks / shares + their actor lists.

import { getPost, relTime }     from '../data.js';
import { likersOf, getComments } from '../interactions.js';
import { renderAvatar }         from '../avatar.js';
import { currentUser }          from '../auth.js';
import { url }                  from '../router.js';
import { icon }                 from '../icons.js';

let renderVersion = 0;

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function userRow(u, sub) {
  const profileUrl = url('/' + u.handle);
  return (
    '<div class="analytics-row">' +
      renderAvatar(u, { tag: 'a', href: profileUrl }) +
      '<div class="analytics-row__text">' +
        '<a class="analytics-row__name" href="' + profileUrl + '">' + escape(u.name) + '</a>' +
        '<a class="analytics-row__handle" href="' + profileUrl + '">@' + escape(u.handle) + '</a>' +
      '</div>' +
      (sub ? '<span class="analytics-row__time">' + escape(sub) + '</span>' : '') +
    '</div>'
  );
}

function emptyList(label) {
  return '<div class="stub stub--inline"><p class="stub__sub">まだ ' + escape(label) + ' はありません。</p></div>';
}

export function renderPostAnalytics(id) {
  renderVersion++;
  return (
    '<div class="post-analytics" id="post-analytics-' + escape(id) + '">' +
      '<div class="stub"><p class="stub__sub">読み込み中…</p></div>' +
    '</div>'
  );
}

export async function hydratePostAnalytics(id) {
  const myVersion = renderVersion;
  const root = document.getElementById('post-analytics-' + cssEscape(id));
  if (!root) return;

  let post;
  try { post = await getPost(id); } catch (err) {
    root.innerHTML = '<div class="stub"><h2 class="stub__title">読み込みに失敗</h2><p class="stub__sub">' + escape(err.message || String(err)) + '</p></div>';
    return;
  }
  if (myVersion !== renderVersion) return;
  if (!post) {
    root.innerHTML = '<div class="stub"><h2 class="stub__title">投稿が見つかりません</h2><a class="back-home" href="/">← Home</a></div>';
    return;
  }

  const me = currentUser();
  if (!me || me.handle !== post.authorHandle) {
    root.innerHTML =
      '<div class="stub">' +
        '<h2 class="stub__title">権限がありません</h2>' +
        '<p class="stub__sub">この画面は投稿主だけが見られます。</p>' +
        '<a class="back-home" href="' + url('/post/' + post.id) + '">← 投稿に戻る</a>' +
      '</div>';
    return;
  }

  const [likers, comments] = await Promise.all([
    likersOf(post.id).catch(err => { console.warn('likersOf', err); return []; }),
    getComments(post.id).catch(err => { console.warn('getComments', err); return []; }),
  ]);
  if (myVersion !== renderVersion) return;

  root.innerHTML =
    '<a class="back-home" href="' + url('/post/' + post.id) + '">' +
      icon('reply', { size: 14, className: 'icon--inline' }) + '投稿に戻る' +
    '</a>' +
    '<header class="analytics-head">' +
      '<h2>アクティビティ</h2>' +
      '<p class="dim">' + escape(post.body).slice(0, 120) +
        (post.body.length > 120 ? '…' : '') + '</p>' +
    '</header>' +
    '<section class="analytics-summary">' +
      summaryTile(icon('heart', { size: 18 }), 'いいね',     likers.length) +
      summaryTile(icon('reply', { size: 18 }), 'コメント',   comments.length) +
      summaryTile(icon('fork',  { size: 18 }), 'リポスト',   '—', 'まだ実装中') +
      summaryTile(icon('chart', { size: 18 }), '引用',       '—', 'まだ実装中') +
      summaryTile(icon('star',  { size: 18 }), '保存',       '—', 'まだ実装中') +
      summaryTile(icon('share', { size: 18 }), '共有',       '—', 'まだ実装中') +
    '</section>' +
    '<section class="analytics-section">' +
      '<h3>' + icon('heart', { size: 14, className: 'icon--inline' }) + 'いいねした人 (' + likers.length + ')</h3>' +
      (likers.length
        ? '<div class="analytics-list">' + likers.map(r => userRow(r.user, r.createdAt ? relTime(new Date(r.createdAt).getTime()) : '')).join('') + '</div>'
        : emptyList('いいね')) +
    '</section>' +
    '<section class="analytics-section">' +
      '<h3>' + icon('reply', { size: 14, className: 'icon--inline' }) + 'コメントした人 (' + comments.length + ')</h3>' +
      (comments.length
        ? '<div class="analytics-list">' + comments.map(c => userRow(c.author, relTime(c.createdAt))).join('') + '</div>'
        : emptyList('コメント')) +
    '</section>';
}

function summaryTile(iconHtml, label, value, hint) {
  return (
    '<div class="analytics-tile' + (hint ? ' analytics-tile--soon' : '') + '" title="' + escape(hint || '') + '">' +
      '<div class="analytics-tile__ico">' + iconHtml + '</div>' +
      '<div class="analytics-tile__value">' + escape(value) + '</div>' +
      '<div class="analytics-tile__label">' + escape(label) + '</div>' +
    '</div>'
  );
}

function cssEscape(s) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
