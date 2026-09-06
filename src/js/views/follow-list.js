import { isPostingAsOfficial } from '../posting-identity.js';
import { isOfficialFollowing, isOfficialRequested, hydrateOfficialFollows } from '../interactions.js';
import { OFFICIAL_HANDLE, getOfficialAccount } from '../official-account.js';
// Following / Followers list page. Reached from the counts on a profile.
// Same DOM shape as the right-rail Who-to-follow card so the existing
// follow/unfollow event delegation in main.js still applies.

import { followersOf, followingOf, isFollowing, cachedFollowList } from '../interactions.js';
import { currentUser } from '../auth.js';
import { renderAvatar } from '../avatar.js';
import { url, currentPath } from '../router.js';
import { t } from '../i18n.js';
import { maskHandle, maskName, maskMentionsInText } from '../privacy-mode.js';
import { withTimeout } from '../net-utils.js';
import { getUser } from '../data.js';
import { icon } from '../icons.js';

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

export function renderFollowList(handle, kind) {
  // Tab order is fixed regardless of `kind`: Following on the left,
  // Followers on the right (X style). The `kind` param only decides
  // which tab is marked is-active. Switching the physical position
  // based on `kind` (like the older code did) confused users because
  // the same repo→tab spatial mapping changed under them.
  const followingHref = url('/' + handle + '/following');
  const followersHref = url('/' + handle + '/followers');
  const followingActive = kind === 'following';
  // X (Twitter) 風のヘッダ: 戻る矢印 + 表示名 (上) + @handle (下)。
  // getUser でローカルキャッシュから表示名を引く。cache miss ならハンドルを
  // そのまま表示名として使う (プロフィール表示時に profiles テーブルから
  // fetchProfileByHandle 経由で埋められる)。
  const u = getUser(handle);
  const rawName = (u && u.name) || handle;
  const displayName   = maskName(handle, rawName);
  const displayHandle = maskHandle(handle);
  return (
    '<div class="follow-head follow-head--x">' +
      '<a class="follow-head__back" href="' + url('/' + handle) + '" ' +
          'aria-label="' + escape(t('profile.back')) + '">' +
        icon('arrow_right', { size: 20 }) +
      '</a>' +
      '<div class="follow-head__id">' +
        '<div class="follow-head__name">' + escape(displayName) + '</div>' +
        '<div class="follow-head__handle">@' + escape(displayHandle) + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="timeline__head">' +
      '<a class="tab' + (followingActive ? ' is-active' : '') + '" href="' + followingHref + '">' +
        t('profile.stat.following') +
      '</a>' +
      '<a class="tab' + (!followingActive ? ' is-active' : '') + '" href="' + followersHref + '">' +
        t('profile.stat.followers') +
      '</a>' +
    '</div>' +
    '<div id="follow-list">' +
      '<div class="stub"><p class="stub__sub">' + t('follow.loading') + '</p></div>' +
    '</div>'
  );
}

export async function hydrateFollowList(handle, kind) {
  // Guard by the actual current route, not a monotonic version
  // counter — the counter was bumping on every dispatch (including
  // benign re-renders from auth refresh + GitHub-graph fetch),
  // which left the loading stub up forever when a refresh fired
  // between renderFollowList and the network completing.
  const myPath = '/' + handle + '/' + kind;
  const stillHere = () => currentPath() === myPath;
  // Re-resolve the DOM target after each await: a refresh() between
  // start and resolve replaces #follow-list with a fresh element,
  // and writing to the stale orphaned reference is invisible.
  const slot = () => document.getElementById('follow-list');

  if (!slot()) return;
  const cached = cachedFollowList(handle, kind);
  if (cached) paintFollowUsers(slot(), cached, kind);
  let users;
  try {
    const p = kind === 'followers' ? followersOf(handle) : followingOf(handle);
    // Follow-list queries are simple (single follows→profiles join) so
    // a 10s timeout is generous. Falling back to the error+retry stub
    // faster is preferable to leaving the user staring at "読み込み中".
    users = await withTimeout(p, 8000, kind);
  } catch (err) {
    if (!stillHere()) return;
    if (cached) return; // keep the usable stale-while-refresh list visible
    const list = slot();
    if (list) {
      list.innerHTML =
        '<div class="stub">' +
          '<p class="stub__sub">取得に失敗しました: ' + escape(err.message || '') + '</p>' +
          '<button class="btn btn--ghost btn--sm" data-follow-list-retry="1">再試行</button>' +
        '</div>';
    }
    return;
  }
  if (!stillHere()) return;
  const list = slot();
  if (!list) return;
  if (isPostingAsOfficial()) {
    try { await hydrateOfficialFollows((await getOfficialAccount())?.id); } catch {}
  }
  if (!stillHere()) return;
  paintFollowUsers(list, users, kind);
}

function paintFollowUsers(list, users, kind) {
  if (!list) return;
  if (!users.length) {
    list.innerHTML = '<div class="stub"><p class="stub__sub">' +
      (kind === 'followers' ? t('follow.empty.followers') : t('follow.empty.following')) +
      '</p></div>';
    return;
  }
  const me = currentUser();
  const official = !!me && isPostingAsOfficial();
  const actorHandle = official ? OFFICIAL_HANDLE : me?.handle;
  list.innerHTML = '<div class="followlist followlist--page">' +
    users.map(u => {
      const followed = me && actorHandle !== u.handle && (official ? isOfficialFollowing(u.handle) : isFollowing(me.handle, u.handle));
      const requested = official && isOfficialRequested(u.handle);
      const showBtn  = me && actorHandle !== u.handle;
      const displayName   = maskName(u.handle, u.name);
      const displayHandle = maskHandle(u.handle);
      return (
        '<div class="followlist__row">' +
          renderAvatar(u, { tag: 'a', href: url('/' + u.handle), size: 'lg' }) +
          '<div class="followlist__text">' +
            '<a class="followlist__name" href="' + url('/' + u.handle) + '">' + escape(displayName) + '</a>' +
            '<a class="followlist__handle" href="' + url('/' + u.handle) + '">@' + escape(displayHandle) + '</a>' +
            (u.bio ? '<div class="followlist__bio">' + escape(maskMentionsInText(u.bio)) + '</div>' : '') +
          '</div>' +
          (showBtn
            ? '<button class="followlist__follow' + (followed || requested ? ' is-following' : '') + '" data-target="' + escape(u.handle) + '">' +
                (requested ? t('profile.btn.requested') : followed ? t('profile.btn.following') : t('profile.btn.follow')) +
              '</button>'
            : '') +
        '</div>'
      );
    }).join('') +
    '</div>';
}
