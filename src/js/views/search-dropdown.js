// Topbar search → live dropdown of matching users.
//
// All accounts live in localStorage, so only users registered on the
// current device are searchable. When the query looks like a handle but
// no local match exists, we still offer "open as profile" and a direct
// GitHub link as fallbacks.

import { allUsers } from '../data.js';
import { url, navigate } from '../router.js';
import { renderAvatar } from '../avatar.js';
import { icon } from '../icons.js';

let dropdownEl  = null;
let activeIndex = -1;
let lastResults = [];

const HANDLE_RE = /^[A-Za-z0-9_-]{1,39}$/;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function mount(host) {
  if (dropdownEl) return;
  dropdownEl = document.createElement('div');
  dropdownEl.id = 'search-results';
  dropdownEl.className = 'search-results';
  dropdownEl.hidden = true;
  host.appendChild(dropdownEl);
}

function searchLocal(q) {
  const lower = q.toLowerCase();
  return Object.values(allUsers())
    .map(u => {
      const handle = (u.handle || '').toLowerCase();
      const name   = (u.name   || '').toLowerCase();
      let score = 0;
      if (handle === lower)          score = 100;
      else if (handle.startsWith(lower)) score = 80;
      else if (handle.includes(lower))   score = 60;
      else if (name.startsWith(lower))   score = 50;
      else if (name.includes(lower))     score = 30;
      return score ? { u, score } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(x => x.u);
}

function buildResults(q) {
  const local = searchLocal(q);
  const items = local.map(u => ({
    kind: 'local',
    handle: u.handle,
    path: '/' + u.handle,
    user: u,
  }));

  // If query looks like a handle, always surface direct nav as a fallback.
  if (HANDLE_RE.test(q)) {
    const exists = local.some(u => u.handle.toLowerCase() === q.toLowerCase());
    if (!exists) {
      items.push({ kind: 'jump',   handle: q, path: '/' + q });
      items.push({ kind: 'github', handle: q });
    }
  }
  return items;
}

function render(items, q) {
  if (!items.length) {
    dropdownEl.innerHTML =
      '<div class="search-results__empty">' +
        '「' + escapeHtml(q) + '」 に一致するユーザーが見つかりません' +
        '<div class="search-results__hint">アカウントはこの端末にしか保存されません。別端末で登録されたユーザーは検索できません。</div>' +
      '</div>';
    activeIndex = -1;
    return;
  }
  dropdownEl.innerHTML = items.map((it, i) => {
    if (it.kind === 'local') {
      return (
        '<a class="search-result" data-idx="' + i + '" href="' + url(it.path) + '">' +
          renderAvatar(it.user, {}) +
          '<div class="search-result__main">' +
            '<div class="search-result__name">' + escapeHtml(it.user.name) + '</div>' +
            '<div class="search-result__handle">@' + escapeHtml(it.user.handle) + '</div>' +
          '</div>' +
        '</a>'
      );
    }
    if (it.kind === 'jump') {
      return (
        '<a class="search-result search-result--alt" data-idx="' + i + '" href="' + url(it.path) + '">' +
          '<span class="search-result__icon">' + icon('user', { size: 18 }) + '</span>' +
          '<div class="search-result__main">' +
            '<div class="search-result__name">プロフィールを開く: /' + escapeHtml(it.handle) + '</div>' +
            '<div class="search-result__handle">この端末に登録が無くてもページは開きます</div>' +
          '</div>' +
        '</a>'
      );
    }
    // github
    return (
      '<a class="search-result search-result--alt" data-idx="' + i + '" href="https://github.com/' + encodeURIComponent(it.handle) + '" target="_blank" rel="noopener">' +
        '<span class="search-result__icon">' + icon('github', { size: 18, fill: true }) + '</span>' +
        '<div class="search-result__main">' +
          '<div class="search-result__name">GitHub で @' + escapeHtml(it.handle) + ' を見る</div>' +
          '<div class="search-result__handle">github.com/' + escapeHtml(it.handle) + '</div>' +
        '</div>' +
      '</a>'
    );
  }).join('');
  activeIndex = 0;
  paintActive();
}

function paintActive() {
  if (!dropdownEl) return;
  dropdownEl.querySelectorAll('.search-result').forEach((el, i) => {
    el.classList.toggle('is-active', i === activeIndex);
  });
}

function open() {
  if (!dropdownEl) return;
  dropdownEl.hidden = false;
}
function close() {
  if (!dropdownEl) return;
  dropdownEl.hidden = true;
  activeIndex = -1;
}

export function initSearch() {
  const wrap  = document.querySelector('.topbar__search');
  const input = wrap?.querySelector('input');
  if (!wrap || !input) return;
  wrap.style.position ||= 'relative';
  mount(wrap);

  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (!q) { close(); return; }
    lastResults = buildResults(q);
    render(lastResults, q);
    open();
  });

  input.addEventListener('focus', () => {
    if (input.value.trim()) open();
  });

  input.addEventListener('keydown', (e) => {
    if (dropdownEl.hidden) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, lastResults.length - 1);
      paintActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(0, activeIndex - 1);
      paintActive();
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && lastResults[activeIndex]) {
        e.preventDefault();
        const it = lastResults[activeIndex];
        if (it.kind === 'github') {
          window.open('https://github.com/' + encodeURIComponent(it.handle), '_blank', 'noopener');
        } else {
          navigate(it.path);
          input.value = '';
        }
        close();
      }
    } else if (e.key === 'Escape') {
      close();
      input.blur();
    }
  });

  // Close on outside click.
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) close();
  });

  // Clicking a result navigates and the router intercept handles same-origin
  // hrefs, so we just need to clear the search and close.
  dropdownEl.addEventListener('click', (e) => {
    const a = e.target.closest('.search-result');
    if (!a) return;
    input.value = '';
    close();
  });
}
