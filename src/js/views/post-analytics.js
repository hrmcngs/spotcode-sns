// Per-post analytics dashboard, visible only to the post author.
// Route: /post/<id>/analytics
//
// Shows totals + the list of who did each action. Right now (PR A) that
// is: likes (with actor list) + comments (with author list). PR B will
// add reposts / quotes / bookmarks / shares + their actor lists.

import { getPost, relTime }     from '../data.js';
import { likersOf, getComments,
         repostersOf, bookmarkersOf, quotersOf } from '../interactions.js';
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
  // getElementById takes a literal id — see note in post-detail.js.
  const root = document.getElementById('post-analytics-' + id);
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

  const [likers, comments, reposters, bookmarkers, quoters] = await Promise.all([
    likersOf(post.id).catch(err => { console.warn('likersOf', err); return []; }),
    getComments(post.id).catch(err => { console.warn('getComments', err); return []; }),
    repostersOf(post.id).catch(err => { console.warn('repostersOf', err); return []; }),
    bookmarkersOf(post.id).catch(err => { console.warn('bookmarkersOf', err); return []; }),
    quotersOf(post.id).catch(err => { console.warn('quotersOf', err); return []; }),
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
      summaryTile(icon('heart', { size: 18 }), 'いいね',     likers.length,      '#likers') +
      summaryTile(icon('reply', { size: 18 }), 'コメント',   comments.length,    '#commenters') +
      summaryTile(icon('fork',  { size: 18 }), 'リポスト',   reposters.length,   '#reposters') +
      summaryTile(icon('chart', { size: 18 }), '引用',       quoters.length,     '#quoters') +
      summaryTile(icon('star',  { size: 18 }), '保存',       bookmarkers.length, '#bookmarkers') +
      summaryTile(icon('share', { size: 18 }), '共有',       '—', null, '集計は未対応 (クライアント側のみ)') +
    '</section>' +
    sectionHtml('likers',      icon('heart', { size: 14, className: 'icon--inline' }), 'いいねした人',     likers.map(r => userRow(r.user, r.createdAt ? relTime(new Date(r.createdAt).getTime()) : ''))) +
    sectionHtml('commenters',  icon('reply', { size: 14, className: 'icon--inline' }), 'コメントした人',   comments.map(c => userRow(c.author, relTime(c.createdAt)))) +
    sectionHtml('reposters',   icon('fork',  { size: 14, className: 'icon--inline' }), 'リポストした人',   reposters.map(r => userRow(r.user, r.createdAt ? relTime(new Date(r.createdAt).getTime()) : ''))) +
    sectionHtml('quoters',     icon('chart', { size: 14, className: 'icon--inline' }), '引用した人',       quoters.map(q => userRow(q.user, q.createdAt ? relTime(new Date(q.createdAt).getTime()) : ''))) +
    sectionHtml('bookmarkers', icon('star',  { size: 14, className: 'icon--inline' }), '保存した人',       bookmarkers.map(b => userRow(b.user, b.createdAt ? relTime(new Date(b.createdAt).getTime()) : '')));
}

function sectionHtml(anchor, iconHtml, label, rows) {
  return (
    '<section class="analytics-section" id="' + anchor + '">' +
      '<h3>' + iconHtml + label + ' (' + rows.length + ')</h3>' +
      (rows.length
        ? '<div class="analytics-list">' + rows.join('') + '</div>'
        : emptyList(label)) +
    '</section>'
  );
}

// Tile: optional anchor scrolls to the matching list below; optional
// hint shows a tooltip (used for the share tile which has no list).
function summaryTile(iconHtml, label, value, anchor, hint) {
  const open  = anchor ? '<a class="analytics-tile" href="' + anchor + '"' : '<div class="analytics-tile' + (hint ? ' analytics-tile--soon' : '') + '"' +
                  (hint ? ' title="' + escape(hint) + '"' : '');
  const close = anchor ? '</a>' : '</div>';
  return (
    open + '>' +
      '<div class="analytics-tile__ico">' + iconHtml + '</div>' +
      '<div class="analytics-tile__value">' + escape(value) + '</div>' +
      '<div class="analytics-tile__label">' + escape(label) + '</div>' +
    close
  );
}

function cssEscape(s) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
