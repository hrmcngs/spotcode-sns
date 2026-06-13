// Quote modal — opens when the user picks "引用" from the repost menu.
// Shows a small composer (body only — quotes don't take a spot or URL
// in this first cut) with the quoted post embedded below for context.
// Persists via addQuote() so the new post carries quote_of_post_id.

import { getPost, addQuote, relTime } from '../data.js';
import { currentUser }                 from '../auth.js';
import { renderAvatar }                from '../avatar.js';
import { icon }                        from '../icons.js';
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock.js';
import { refresh }                     from '../router.js';

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

let rootEl = null;

function close() {
  if (!rootEl) return;
  rootEl.remove();
  rootEl = null;
  unlockBodyScroll();
}

export async function openQuoteModal(postId) {
  const me = currentUser();
  if (!me) return;
  let quoted;
  try { quoted = await getPost(postId); } catch { quoted = null; }
  if (!quoted) { alert('引用元の投稿が見つかりません'); return; }

  if (rootEl) close();
  const host = document.createElement('div');
  host.innerHTML =
    '<div class="modal" id="quote-modal">' +
      '<div class="modal__backdrop" data-quote-close></div>' +
      '<div class="modal__card" role="dialog" aria-labelledby="quote-title">' +
        '<button class="modal__close" data-quote-close aria-label="Close">' + icon('close', { size: 18 }) + '</button>' +
        '<h2 id="quote-title" class="auth-form__h">引用</h2>' +
        '<form class="quote-form" id="quote-form">' +
          '<div class="quote-form__row">' +
            renderAvatar(me, { size: 'lg' }) +
            '<textarea name="body" rows="3" maxlength="1000" placeholder="このアイデアに加えて…" required></textarea>' +
          '</div>' +
          '<div class="quote-card quote-card--preview">' +
            '<div class="quote-card__head">' +
              '<span class="quote-card__name">' + escape(quoted.author?.name || quoted.authorHandle) + '</span>' +
              '<span class="quote-card__handle">@' + escape(quoted.author?.handle || quoted.authorHandle) + '</span>' +
              '<span class="quote-card__time">· ' + escape(relTime(quoted.createdAt)) + '</span>' +
            '</div>' +
            '<div class="quote-card__body">' + escape((quoted.body || '').slice(0, 240)) +
              ((quoted.body || '').length > 240 ? '…' : '') +
            '</div>' +
          '</div>' +
          '<div class="edit-actions">' +
            '<button type="button" class="btn btn--ghost" data-quote-close>Cancel</button>' +
            '<button type="submit" class="btn btn--primary">引用してポスト</button>' +
          '</div>' +
          '<p class="auth-error" data-error></p>' +
        '</form>' +
      '</div>' +
    '</div>';
  document.body.appendChild(host.firstElementChild);
  rootEl = document.getElementById('quote-modal');
  lockBodyScroll();

  rootEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-quote-close]')) close();
  });

  const form = document.getElementById('quote-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = form.querySelector('[data-error]');
    err.textContent = '';
    const body = String(form.querySelector('textarea[name="body"]').value || '').trim();
    if (!body) { err.textContent = '本文を入力してください'; return; }
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      await addQuote({ body, status: 'wip' }, postId);
      close();
      refresh();
    } catch (ex) {
      err.textContent = ex.message || String(ex);
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  setTimeout(() => form.querySelector('textarea[name="body"]')?.focus(), 30);
}
