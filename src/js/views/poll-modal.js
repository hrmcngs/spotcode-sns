// Poll-attach modal — opens from the composer chart button. Lets the
// user define a question + 2-4 options + a deadline. The result lands
// in pendingPoll (a module variable on main.js) and is included on
// the next post submit; never persisted on its own.

import { icon }   from '../icons.js';
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock.js';

let rootEl = null;
let resolver = null;

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function close(value) {
  if (!rootEl) return;
  rootEl.remove();
  rootEl = null;
  unlockBodyScroll();
  if (resolver) { const r = resolver; resolver = null; r(value || null); }
}

// Build a local-ISO string (yyyy-mm-ddThh:mm) suitable for
// <input type="datetime-local"> value/min attributes. The browser's
// `Date.toISOString()` always converts to UTC which trips up that
// input in non-UTC zones — slicing the locale string is more
// predictable than wrestling with `getTimezoneOffset()`.
function localIso(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' +
    pad(date.getDate()) + 'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

// Quick presets so users don't have to fiddle with a picker for the
// common "1 day / 3 days / 1 week" deadlines. Each preset returns a
// JS Date in the future.
const PRESETS = [
  { label: '1 時間後', mins:    60 },
  { label: '1 日後',   mins:  1440 },
  { label: '3 日後',   mins:  4320 },
  { label: '1 週間後', mins: 10080 },
];

// `initial` is the pendingPoll already on the composer, so re-opening
// the modal preserves what the user had typed in. Returns a Promise
// that resolves with the new poll object (or null on cancel / delete).
export function openPollModal(initial = null) {
  if (rootEl) close(null);
  const q = initial?.question || '';
  const opts = initial?.options && initial.options.length >= 2
    ? initial.options.slice(0, 4)
    : ['', ''];
  // Default deadline = 1 day from now.
  const def = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const deadline = initial?.deadlineAt
    ? new Date(initial.deadlineAt)
    : def;
  const min = localIso(new Date(Date.now() + 60 * 1000));

  const host = document.createElement('div');
  host.innerHTML =
    '<div class="modal" id="poll-modal">' +
      '<div class="modal__backdrop" data-poll-close></div>' +
      '<div class="modal__card" role="dialog" aria-labelledby="poll-title">' +
        '<button class="modal__close" data-poll-close aria-label="Close">' + icon('close', { size: 18 }) + '</button>' +
        '<h2 id="poll-title" class="auth-form__h">投票を作成</h2>' +
        '<form class="poll-form" id="poll-form">' +
          '<label class="poll-form__label">質問' +
            '<input name="question" type="text" maxlength="120" value="' + escape(q) + '" required placeholder="どっちにする？">' +
          '</label>' +
          '<div class="poll-form__options" id="poll-options">' +
            opts.map((o, i) => optionRow(i, o, opts.length)).join('') +
          '</div>' +
          '<button type="button" class="btn btn--ghost btn--sm poll-form__add" id="poll-add-option"' +
            (opts.length >= 4 ? ' disabled' : '') + '>＋ 選択肢を追加</button>' +
          '<label class="poll-form__label">期限' +
            '<input name="deadline" type="datetime-local" required ' +
              'min="' + min + '" value="' + localIso(deadline) + '">' +
          '</label>' +
          '<div class="poll-form__presets">' +
            PRESETS.map(p =>
              '<button type="button" class="btn btn--ghost btn--sm" data-poll-preset="' + p.mins + '">' + p.label + '</button>'
            ).join('') +
          '</div>' +
          '<div class="edit-actions">' +
            (initial ? '<button type="button" class="btn btn--ghost" data-poll-delete>投票を外す</button>' : '') +
            '<button type="button" class="btn btn--ghost" data-poll-close>キャンセル</button>' +
            '<button type="submit" class="btn btn--primary">投票を追加</button>' +
          '</div>' +
          '<p class="auth-error" data-error></p>' +
        '</form>' +
      '</div>' +
    '</div>';
  document.body.appendChild(host.firstElementChild);
  rootEl = document.getElementById('poll-modal');
  lockBodyScroll();

  rootEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-poll-close]')) { close(null); return; }
    if (e.target.closest('[data-poll-delete]')) { close({ delete: true }); return; }
    // "Remove this option" × button on a row
    const removeBtn = e.target.closest('[data-poll-remove]');
    if (removeBtn) {
      const optsBox = document.getElementById('poll-options');
      if (optsBox.querySelectorAll('.poll-form__option').length > 2) {
        removeBtn.closest('.poll-form__option').remove();
        relabel();
      }
      return;
    }
    // Add option
    if (e.target.closest('#poll-add-option')) {
      const optsBox = document.getElementById('poll-options');
      const count = optsBox.querySelectorAll('.poll-form__option').length;
      if (count >= 4) return;
      optsBox.insertAdjacentHTML('beforeend', optionRow(count, '', count + 1));
      relabel();
      return;
    }
    // Deadline preset
    const preset = e.target.closest('[data-poll-preset]');
    if (preset) {
      const mins = Number(preset.getAttribute('data-poll-preset'));
      const next = new Date(Date.now() + mins * 60 * 1000);
      document.querySelector('#poll-form input[name="deadline"]').value = localIso(next);
      return;
    }
  });

  const form = document.getElementById('poll-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const err = form.querySelector('[data-error]');
    err.textContent = '';
    const question = String(form.querySelector('input[name="question"]').value || '').trim();
    if (!question) { err.textContent = '質問を入力してください'; return; }
    const optionEls = form.querySelectorAll('.poll-form__option input[name="opt"]');
    const options = [...optionEls].map(el => String(el.value || '').trim()).filter(Boolean);
    if (options.length < 2) { err.textContent = '選択肢は 2 つ以上必要です'; return; }
    if (new Set(options).size !== options.length) {
      err.textContent = '選択肢が重複しています'; return;
    }
    const deadlineStr = form.querySelector('input[name="deadline"]').value;
    const deadlineAt = deadlineStr ? new Date(deadlineStr).getTime() : 0;
    if (!deadlineAt || deadlineAt <= Date.now() + 30 * 1000) {
      err.textContent = '期限はもう少し先に設定してください'; return;
    }
    close({ question, options, deadlineAt });
  });

  setTimeout(() => form.querySelector('input[name="question"]')?.focus(), 30);

  return new Promise((res) => { resolver = res; });
}

function optionRow(i, value, total) {
  return (
    '<div class="poll-form__option">' +
      '<span class="poll-form__num">' + (i + 1) + '</span>' +
      '<input name="opt" type="text" maxlength="60" value="' + escape(value) + '" placeholder="選択肢 ' + (i + 1) + '">' +
      (total > 2
        ? '<button type="button" class="poll-form__rm" data-poll-remove aria-label="削除">×</button>'
        : '') +
    '</div>'
  );
}

function relabel() {
  const rows = document.querySelectorAll('#poll-options .poll-form__option');
  rows.forEach((row, i) => {
    row.querySelector('.poll-form__num').textContent = String(i + 1);
    const input = row.querySelector('input[name="opt"]');
    if (!input.value) input.placeholder = '選択肢 ' + (i + 1);
  });
  document.getElementById('poll-add-option').disabled = rows.length >= 4;
  // Refresh remove buttons — only show when there are more than 2 rows.
  rows.forEach((row) => {
    const existing = row.querySelector('.poll-form__rm');
    if (rows.length > 2 && !existing) {
      row.insertAdjacentHTML('beforeend',
        '<button type="button" class="poll-form__rm" data-poll-remove aria-label="削除">×</button>');
    } else if (rows.length <= 2 && existing) {
      existing.remove();
    }
  });
}
