// Following / Followers list page. Reached from the counts on a profile.
// Same DOM shape as the right-rail Who-to-follow card so the existing
// follow/unfollow event delegation in main.js still applies.

import { followersOf, followingOf, isFollowing } from '../interactions.js';
import { currentUser } from '../auth.js';
import { renderAvatar } from '../avatar.js';
import { url } from '../router.js';
import { t } from '../i18n.js';

let renderVersion = 0;

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

export function renderFollowList(handle, kind) {
  renderVersion++;
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
  const myVersion = renderVersion;
  const list = document.getElementById('follow-list');
  if (!list) return;
  let users;
  try {
    users = kind === 'followers' ? await followersOf(handle) : await followingOf(handle);
  } catch (err) {
    if (myVersion !== renderVersion) return;
    list.innerHTML = '<div class="stub"><p class="stub__sub">取得に失敗しました: ' + escape(err.message || '') + '</p></div>';
    return;
  }
  if (myVersion !== renderVersion) return;
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
      return (
        '<div class="followlist__row">' +
          renderAvatar(u, { tag: 'a', href: url('/' + u.handle), size: 'lg' }) +
          '<div class="followlist__text">' +
            '<a class="followlist__name" href="' + url('/' + u.handle) + '">' + escape(u.name) + '</a>' +
            '<a class="followlist__handle" href="' + url('/' + u.handle) + '">@' + escape(u.handle) + '</a>' +
            (u.bio ? '<div class="followlist__bio">' + escape(u.bio) + '</div>' : '') +
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
