// Following / Followers list page. Reached from the counts on a profile.
// Same DOM shape as the right-rail Who-to-follow card so the existing
// follow/unfollow event delegation in main.js still applies.

import { followersOf, followingOf, isFollowing } from '../interactions.js';
import { currentUser } from '../auth.js';
import { renderAvatar } from '../avatar.js';
import { url, currentPath } from '../router.js';
import { t } from '../i18n.js';
import { maskHandle, maskName, maskMentionsInText } from '../privacy-mode.js';
import { withTimeout } from '../net-utils.js';

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

export function renderFollowList(handle, kind) {
  const titleLeft  = kind === 'followers' ? t('profile.stat.followers') : t('profile.stat.following');
  const titleRight = kind === 'followers' ? t('profile.stat.following') : t('profile.stat.followers');
  const leftHref   = url('/' + handle + '/' + kind);
  const rightHref  = url('/' + handle + '/' + (kind === 'followers' ? 'following' : 'followers'));
  return (
    '<div class="follow-head">' +
      '<a class="back-home" href="' + url('/' + handle) + '">← @' + escape(handle) + '</a>' +
    '</div>' +
    '<div class="timeline__head">' +
      '<a class="tab is-active" href="' + leftHref + '">' + titleLeft + '</a>' +
      '<a class="tab" href="' + rightHref + '">' + titleRight + '</a>' +
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
  let users;
  try {
    const p = kind === 'followers' ? followersOf(handle) : followingOf(handle);
    users = await withTimeout(p, 15000, kind);
  } catch (err) {
    if (!stillHere()) return;
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
  if (!users.length) {
    list.innerHTML = '<div class="stub"><p class="stub__sub">' +
      (kind === 'followers' ? t('follow.empty.followers') : t('follow.empty.following')) +
      '</p></div>';
    return;
  }
  const me = currentUser();
  list.innerHTML = '<div class="followlist followlist--page">' +
    users.map(u => {
      const followed = me && me.handle !== u.handle && isFollowing(me.handle, u.handle);
      const showBtn  = me && me.handle !== u.handle;
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
            ? '<button class="followlist__follow' + (followed ? ' is-following' : '') + '" data-target="' + escape(u.handle) + '">' +
                (followed ? t('profile.btn.following') : t('profile.btn.follow')) +
              '</button>'
            : '') +
        '</div>'
      );
    }).join('') +
    '</div>';
}
