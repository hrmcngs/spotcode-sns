// Post detail page — single post at the top, comment thread below,
// composer at the bottom (or a sign-in CTA if logged out). Route:
// /post/<id>. The author also sees an "Analytics" link to
// /post/<id>/analytics.

import { getPost }                      from '../data.js';
import { renderPost }                   from '../post.js';
import { renderAvatar }                 from '../avatar.js';
import { currentUser }                  from '../auth.js';
import { url }                          from '../router.js';
import { icon }                         from '../icons.js';
import { getComments, addComment, removeComment } from '../interactions.js';
import { relTime }                      from '../data.js';

let renderVersion = 0;
let currentPostId = null;

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function renderComment(c, me) {
  const isMine = me && c.author?.handle === me.handle;
  const profileUrl = url('/' + (c.author?.handle || ''));
  return (
    '<article class="comment" data-comment-id="' + escape(c.id) + '">' +
      renderAvatar(c.author, { tag: 'a', href: profileUrl, size: 'sm' }) +
      '<div class="comment__main">' +
        '<div class="comment__head">' +
          '<a class="comment__name" href="' + profileUrl + '">' + escape(c.author?.name || '?') + '</a>' +
          '<a class="comment__handle" href="' + profileUrl + '">@' + escape(c.author?.handle || '?') + '</a>' +
          '<span class="comment__sep">·</span>' +
          '<span class="comment__time">' + escape(relTime(c.createdAt)) + '</span>' +
          (isMine
            ? '<button class="comment__delete" title="削除" data-comment-delete="' + escape(c.id) + '">' +
                icon('trash', { size: 14 }) + '</button>'
            : '') +
        '</div>' +
        '<div class="comment__body">' + escape(c.body) + '</div>' +
      '</div>' +
    '</article>'
  );
}

function commentComposer(me) {
  if (!me) {
    return (
      '<div class="comment-gate">' +
        '<button class="btn btn--primary" data-auth="login">サインインしてコメントする</button>' +
      '</div>'
    );
  }
  return (
    '<form class="comment-form" id="comment-form">' +
      renderAvatar(me, { size: 'sm' }) +
      '<div class="comment-form__main">' +
        '<textarea name="body" rows="2" maxlength="500" placeholder="コメントを書く…"></textarea>' +
        '<div class="comment-form__actions">' +
          '<button type="submit" class="btn btn--primary btn--sm">送信</button>' +
        '</div>' +
      '</div>' +
    '</form>'
  );
}

export function renderPostDetail(id) {
  renderVersion++;
  currentPostId = id;
  return (
    '<div class="post-detail" id="post-detail-' + escape(id) + '">' +
      '<div class="stub" id="post-detail-loading">' +
        '<p class="stub__sub">読み込み中…</p>' +
      '</div>' +
    '</div>'
  );
}

export async function hydratePostDetail(id) {
  const myVersion = renderVersion;
  const root = document.getElementById('post-detail-' + cssEscape(id));
  if (!root) return;

  let post;
  try { post = await getPost(id); }
  catch (err) {
    if (myVersion !== renderVersion) return;
    root.innerHTML = '<div class="stub"><h2 class="stub__title">読み込みに失敗</h2><p class="stub__sub">' + escape(err.message || String(err)) + '</p><a class="back-home" href="/">← Home</a></div>';
    return;
  }
  if (myVersion !== renderVersion) return;
  if (!post) {
    root.innerHTML = '<div class="stub"><h2 class="stub__title">投稿が見つかりません</h2><p class="stub__sub">削除されたか、閲覧権限がありません。</p><a class="back-home" href="/">← Home</a></div>';
    return;
  }

  const me = currentUser();
  const isOwn = me && me.handle === post.authorHandle;
  const analyticsLink = isOwn
    ? '<a class="post-detail__analytics" href="' + url('/post/' + post.id + '/analytics') + '">' +
        icon('chart', { size: 14, className: 'icon--inline' }) + 'アクティビティを見る' +
      '</a>'
    : '';

  let comments = [];
  try { comments = await getComments(id); } catch (err) { console.warn('getComments', err); }
  if (myVersion !== renderVersion) return;

  root.innerHTML =
    '<a class="back-home" href="/">' + icon('reply', { size: 14, className: 'icon--inline' }) + 'Home に戻る</a>' +
    renderPost(post) +
    (analyticsLink ? '<div class="post-detail__bar">' + analyticsLink + '</div>' : '') +
    '<div class="comment-list-head">' +
      '<h3>コメント <span class="dim">(' + comments.length + ')</span></h3>' +
    '</div>' +
    commentComposer(me) +
    '<div class="comment-list" id="comment-list">' +
      (comments.length
        ? comments.map(c => renderComment(c, me)).join('')
        : '<div class="stub"><p class="stub__sub">まだコメントはありません。最初のひとことを。</p></div>') +
    '</div>';

  bindCommentForm(post);
}

function bindCommentForm(post) {
  const form = document.getElementById('comment-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ta = form.querySelector('textarea[name="body"]');
    const text = (ta?.value || '').trim();
    if (!text) { ta?.focus(); return; }
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const me = currentUser();
      const c  = await addComment(post.id, text);
      // Optimistic insert at the bottom of the list.
      const list = document.getElementById('comment-list');
      if (list) {
        if (list.querySelector('.stub')) list.innerHTML = '';
        list.insertAdjacentHTML('beforeend', renderComment(c, me));
      }
      ta.value = '';
      ta.style.height = 'auto';
      // Bump the count in the head.
      const head = document.querySelector('.comment-list-head h3 .dim');
      if (head) head.textContent = '(' + (document.querySelectorAll('.comment').length) + ')';
    } catch (err) {
      alert('コメント送信に失敗しました: ' + err.message);
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

// Delegated click for the per-comment trash button. Bound once from
// main.js — exposed here so main.js doesn't need to know about comments.
export async function handleCommentDelete(commentId) {
  if (!commentId) return;
  if (!confirm('このコメントを削除しますか？')) return;
  try {
    await removeComment(commentId);
    const el = document.querySelector('.comment[data-comment-id="' + cssEscape(commentId) + '"]');
    if (el) el.remove();
    const head = document.querySelector('.comment-list-head h3 .dim');
    if (head) head.textContent = '(' + document.querySelectorAll('.comment').length + ')';
  } catch (err) {
    alert('削除に失敗しました: ' + err.message);
  }
}

// Lightweight CSS.escape polyfill — querySelector with a UUID needs it
// because the dash characters aren't special but some IDs might contain
// other chars in future. Native CSS.escape is widely supported but the
// fallback keeps us safe on older webviews.
function cssEscape(s) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
