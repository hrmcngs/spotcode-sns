// Modal for reporting a post. Reasons are stored verbatim in the
// reports localStorage entry so a future moderator view can group them.

import { currentUser }            from '../auth.js';
import { reportPost, reportedByMe } from '../interactions.js';
import { icon }                   from '../icons.js';
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock.js';

let rootEl    = null;
let activePostId = null;
let resolveFn = null;

const REASONS = [
  { id: 'spam',         label: 'スパム / 宣伝' },
  { id: 'inappropriate',label: '不適切な内容' },
  { id: 'harassment',   label: '嫌がらせ / ヘイト' },
  { id: 'misinfo',      label: '誤情報' },
  { id: 'other',        label: 'その他' },
];

function template() {
  return (
    '<div class="modal" id="report-modal" hidden>' +
      '<div class="modal__backdrop" data-report-close></div>' +
      '<div class="modal__card" role="dialog" aria-labelledby="report-title">' +
        '<button class="modal__close" data-report-close aria-label="Close">' + icon('close', { size: 18 }) + '</button>' +
        '<h2 id="report-title" class="auth-form__h">投稿を報告</h2>' +
        '<p class="report-hint">どの理由が当てはまりますか？</p>' +
        '<form class="auth-form" id="report-form">' +
          '<fieldset class="role-group">' +
            REASONS.map((r, i) => (
              '<label class="role-opt"><input type="radio" name="reason" value="' + r.id + '"' + (i === 0 ? ' checked' : '') + '>' +
                '<span><b>' + r.label + '</b></span></label>'
            )).join('') +
          '</fieldset>' +
          '<label>追加のコメント <span class="hint">(任意・400 字まで)</span>' +
            '<textarea name="comment" maxlength="400" rows="3" placeholder="運営に伝えたいことがあれば"></textarea>' +
          '</label>' +
          '<div class="edit-actions">' +
            '<button type="button" class="btn btn--ghost" data-report-close>Cancel</button>' +
            '<button type="submit" class="btn btn--primary">送信</button>' +
          '</div>' +
          '<p class="auth-error" data-error></p>' +
          '<p class="report-done" data-done hidden>報告を受け付けました。確認します。</p>' +
        '</form>' +
      '</div>' +
    '</div>'
  );
}

function mount() {
  if (rootEl) return;
  const host = document.createElement('div');
  host.innerHTML = template();
  document.body.appendChild(host.firstElementChild);
  rootEl = document.getElementById('report-modal');

  rootEl.addEventListener('click', (e) => {
    if (e.target.matches('[data-report-close]')) close(null);
  });

  document.getElementById('report-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const err  = form.querySelector('[data-error]');
    const done = form.querySelector('[data-done]');
    err.textContent = '';
    const me = currentUser();
    if (!me) { err.textContent = 'ログインしてください'; return; }
    if (!activePostId) { err.textContent = '対象投稿が不明です'; return; }
    const fd = new FormData(form);
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      await reportPost({
        postId:  activePostId,
        reason:  fd.get('reason'),
        comment: fd.get('comment'),
      });
      done.hidden = false;
      setTimeout(() => close({ ok: true }), 900);
    } catch (ex) {
      err.textContent = ex.message || String(ex);
      submitBtn.disabled = false;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && rootEl && !rootEl.hidden) close(null);
  });
}

function close(result) {
  if (!rootEl || rootEl.hidden) return;
  rootEl.hidden = true;
  unlockBodyScroll();
  activePostId = null;
  if (resolveFn) { resolveFn(result); resolveFn = null; }
}

export function openReport(postId) {
  mount();
  activePostId = postId;
  const form = document.getElementById('report-form');
  form.reset();
  form.querySelector('button[type="submit"]').disabled = false;
  form.querySelector('[data-error]').textContent = '';
  form.querySelector('[data-done]').hidden = true;

  const me = currentUser();
  if (me) {
    reportedByMe(postId).then((already) => {
      if (!already) return;
      form.querySelector('[data-done]').textContent = 'この投稿は既に報告済みです（再送で上書きされます）';
      form.querySelector('[data-done]').hidden = false;
    });
  }

  rootEl.hidden = false;
  lockBodyScroll();
  return new Promise((res) => { resolveFn = res; });
}
