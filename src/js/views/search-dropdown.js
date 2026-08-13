// Topbar search → live dropdown of matching users.
//
// Local matches (allUsers, including cached fetched profiles) render
// instantly; a debounced query against Supabase profiles fills in
// anyone registered on another device. The fallback "open as profile"
// and "github.com" rows still appear when nothing matches.

import { allUsers } from '../data.js';
import { url, navigate } from '../router.js';
import { renderAvatar } from '../avatar.js';
import { icon } from '../icons.js';
import { searchProfiles } from '../profiles.js';
import { romajiToJp }     from '../jp-romaji.js';

let dropdownEl  = null;
let activeIndex = -1;
let lastResults = [];
let currentQuery = '';
let debounceTimer = null;

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

function scoreUser(u, lower) {
  const handle = (u.handle || '').toLowerCase();
  const name   = (u.name   || '').toLowerCase();
  if (handle === lower)              return 100;
  if (handle.startsWith(lower))      return 80;
  if (handle.includes(lower))        return 60;
  if (name.startsWith(lower))        return 50;
  if (name.includes(lower))          return 30;
  return 0;
}

function searchLocal(q) {
  const lower = q.toLowerCase();
  return Object.values(allUsers())
    .map(u => ({ u, score: scoreUser(u, lower) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(x => x.u);
}

function withFallbacks(items, q) {
  // If query looks like a handle and nothing matched it exactly, surface
  // a direct nav and a GitHub link as "always-available" fallbacks.
  if (!HANDLE_RE.test(q)) return items;
  const exists = items.some(it =>
    it.kind === 'local' && it.user.handle.toLowerCase() === q.toLowerCase()
  );
  if (exists) return items;
  return [
    ...items,
    { kind: 'jump',   handle: q, path: '/' + q },
    { kind: 'github', handle: q },
  ];
}

function localItems(q) {
  return searchLocal(q).map(u => ({
    kind: 'local',
    handle: u.handle,
    path: '/' + u.handle,
    user: u,
  }));
}

// When the query is a romaji slug we know (e.g. "shibuya", "setagaya"),
// surface a "Posts in <JP>" suggestion at the top of the dropdown so a
// non-JP keyboard user can still discover the spot view.
function spotItems(q) {
  const jp = romajiToJp(q);
  if (!jp) return [];
  return [{
    kind: 'spot',
    label: jp,
    romaji: q.toLowerCase(),
    path: '/spot/' + encodeURIComponent(jp),
  }];
}

function mergeLocalAndRemote(localItems, remoteUsers, q) {
  const lower = q.toLowerCase();
  const byHandle = new Map();
  localItems.forEach(it => byHandle.set(it.user.handle.toLowerCase(), it));
  remoteUsers.forEach(u => {
    const k = u.handle.toLowerCase();
    if (!byHandle.has(k)) {
      byHandle.set(k, { kind: 'local', handle: u.handle, path: '/' + u.handle, user: u });
    }
  });
  // Re-rank by score against the live query for stability.
  return [...byHandle.values()]
    .map(it => ({ it, score: it.kind === 'local' ? scoreUser(it.user, lower) : 1 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 7)
    .map(x => x.it);
}

function render(items, q) {
  if (!items.length) {
    dropdownEl.innerHTML =
      '<div class="search-results__empty">' +
        '「' + escapeHtml(q) + '」 に一致するユーザーが見つかりません' +
        '<div class="search-results__hint">サインアップ済みのアカウントは Supabase に保存されているので、別端末で登録されたユーザーも検索できます。</div>' +
      '</div>';
    activeIndex = -1;
    lastResults = [];
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
    if (it.kind === 'spot') {
      return (
        '<a class="search-result search-result--alt" data-idx="' + i + '" href="' + url(it.path) + '">' +
          '<span class="search-result__icon">' + icon('pin', { size: 18 }) + '</span>' +
          '<div class="search-result__main">' +
            '<div class="search-result__name">' + escapeHtml(it.label) + ' のアイデアを見る</div>' +
            '<div class="search-result__handle">' + escapeHtml(it.romaji) + ' → ' + escapeHtml(it.label) + '</div>' +
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
    return (
      '<a class="search-result search-result--alt" data-idx="' + i + '" href="https://github.com/' + encodeURIComponent(it.handle) + '" target="_blank" rel="noopener">' +
        '<span class="search-result__icon">' + icon('repo', { size: 18 }) + '</span>' +
        '<div class="search-result__main">' +
          '<div class="search-result__name">GitHub で @' + escapeHtml(it.handle) + ' を見る</div>' +
          '<div class="search-result__handle">github.com/' + escapeHtml(it.handle) + '</div>' +
        '</div>' +
      '</a>'
    );
  }).join('');
  activeIndex = 0;
  lastResults = items;
  paintActive();
}

function paintActive() {
  if (!dropdownEl) return;
  dropdownEl.querySelectorAll('.search-result').forEach((el, i) => {
    el.classList.toggle('is-active', i === activeIndex);
  });
}

function open() { if (dropdownEl) dropdownEl.hidden = false; }
function close() {
  if (dropdownEl) { dropdownEl.hidden = true; activeIndex = -1; }
}

async function queryRemote(q) {
  // Show local + spot suggestions immediately so typing feels instant.
  const local = localItems(q);
  const spots = spotItems(q);
  render(withFallbacks([...spots, ...local], q), q);
  open();

  // Then fetch remote in the background.
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    if (q !== currentQuery) return;
    const remote = await searchProfiles(q, 10);
    if (q !== currentQuery) return; // a newer keystroke superseded us
    const merged = mergeLocalAndRemote(local, remote, q);
    render(withFallbacks([...spots, ...merged], q), q);
  }, 220);
}

export function initSearch() {
  const wrap  = document.querySelector('.topbar__search');
  const input = wrap?.querySelector('input');
  if (!wrap || !input) return;
  wrap.style.position ||= 'relative';
  mount(wrap);

  input.addEventListener('input', () => {
    const q = input.value.trim();
    currentQuery = q;
    if (!q) { close(); return; }
    queryRemote(q);
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

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) close();
  });

  dropdownEl.addEventListener('click', (e) => {
    if (e.target.closest('.search-result')) {
      input.value = '';
      close();
    }
  });
}
