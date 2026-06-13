// "Pending follow requests" page — only meaningful for private accounts
// (public accounts auto-accept), but renders an empty state cleanly for
// anyone who lands on /requests.

import { currentUser } from '../auth.js';
import { pendingFollowRequests, acceptFollowRequest,
         denyFollowRequest, hydrateMyFollows } from '../interactions.js';
import { renderAvatar } from '../avatar.js';
import { url } from '../router.js';

let renderVersion = 0;
let pending = [];

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

export function renderRequests() {
  renderVersion++;
  return (
    '<div class="follow-head">' +
      '<h2 style="margin:0;font-size:1.05rem;">フォローリクエスト</h2>' +
    '</div>' +
    '<div id="requests-list">' +
      '<div class="stub"><p class="stub__sub">読み込み中…</p></div>' +
    '</div>'
  );
}

function rowHtml(req) {
  const u = req.user;
  return (
    '<div class="followlist__row" data-handle="' + escape(u.handle) + '">' +
      renderAvatar(u, { tag: 'a', href: url('/' + u.handle), size: 'lg' }) +
      '<div class="followlist__text">' +
        '<a class="followlist__name" href="' + url('/' + u.handle) + '">' + escape(u.name) + '</a>' +
        '<a class="followlist__handle" href="' + url('/' + u.handle) + '">@' + escape(u.handle) + '</a>' +
        (u.bio ? '<div class="followlist__bio">' + escape(u.bio) + '</div>' : '') +
      '</div>' +
      '<div class="request-actions">' +
        '<button type="button" class="btn btn--primary btn--sm" data-action="accept">承認</button>' +
        '<button type="button" class="btn btn--ghost btn--sm" data-action="deny">拒否</button>' +
      '</div>' +
    '</div>'
  );
}

export async function hydrateRequests() {
  const myVersion = renderVersion;
  const list = document.getElementById('requests-list');
  if (!list) return;
  const me = currentUser();
  if (!me) {
    list.innerHTML = '<div class="stub"><p class="stub__sub">ログインしてください。</p></div>';
    return;
  }
  let reqs;
  try { reqs = await pendingFollowRequests(); }
  catch (err) {
    if (myVersion !== renderVersion) return;
    list.innerHTML = '<div class="stub"><p class="stub__sub">取得失敗: ' + escape(err.message || '') + '</p></div>';
    return;
  }
  if (myVersion !== renderVersion) return;
  pending = reqs;
  if (!pending.length) {
    const hint = me.isPrivate
      ? '誰かがあなたをフォローすると、ここに承認待ちのリクエストが並びます。'
      : 'あなたは公開アカウントなのでフォローは自動承認されます。鍵をかけるとここでリクエストを管理できます。';
    list.innerHTML = '<div class="stub"><p class="stub__sub">' + hint + '</p></div>';
    return;
  }
  list.innerHTML = '<div class="followlist followlist--page">' +
    pending.map(rowHtml).join('') +
  '</div>';
  bindActions();
}

function bindActions() {
  const list = document.getElementById('requests-list');
  if (!list || list.dataset.bound === '1') return;
  list.dataset.bound = '1';
  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const row = btn.closest('[data-handle]');
    const handle = row?.getAttribute('data-handle');
    if (!handle) return;
    btn.disabled = true;
    try {
      if (btn.dataset.action === 'accept') await acceptFollowRequest(handle);
      else                                 await denyFollowRequest(handle);
      // Refresh my followsMine cache (the accepted handle just became a
      // mutual follower from the new accepted-follower direction; but more
      // importantly we want the row to disappear).
      try { await hydrateMyFollows(); } catch {}
      row.remove();
      const remaining = document.querySelectorAll('#requests-list .followlist__row').length;
      if (remaining === 0) {
        document.getElementById('requests-list').innerHTML =
          '<div class="stub"><p class="stub__sub">全部処理しました。</p></div>';
      }
    } catch (err) {
      alert('失敗しました: ' + (err.message || ''));
      btn.disabled = false;
    }
  });
}
