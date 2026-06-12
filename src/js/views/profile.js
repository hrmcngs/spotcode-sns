import { getUser, postsByHandle } from '../data.js';
import { renderPost }              from '../post.js';
import { url }                     from '../router.js';
import { currentUser }             from '../auth.js';
import { icon }                    from '../icons.js';

function notFound(handle) {
  return (
    '<div class="stub">' +
      '<h2 class="stub__title">@' + handle + ' is empty here</h2>' +
      '<p class="stub__sub">このアカウントは存在しないか、まだ何も投稿していません。</p>' +
      '<a class="back-home" href="/">← Back to home</a>' +
    '</div>'
  );
}

export function renderProfile(handle) {
  const u = getUser(handle);
  if (!u) return notFound(handle);

  const me = currentUser();
  const isMe = me && me.handle === u.handle;
  const list = postsByHandle(handle);
  const postCount = list.length;
  const ghLink = u.github?.url || (u.github?.handle ? 'https://github.com/' + u.github.handle : null);

  const header = (
    '<header class="profile-header">' +
      '<div class="profile-cover"></div>' +
      '<div class="profile-top">' +
        '<div class="avatar avatar--xl">' + u.avatar + '</div>' +
        '<div class="profile-top__actions">' +
          (isMe
            ? '<button class="btn btn--ghost" id="logout-btn">Log out</button>' +
              '<button class="btn btn--ghost">Edit profile</button>'
            : '<button class="btn btn--ghost">More</button>' +
              '<button class="btn btn--primary">Follow</button>') +
        '</div>' +
      '</div>' +
      '<div class="profile-id">' +
        '<div class="profile-name">' + u.name +
          (u.role === 'programmer' ? ' <span class="role-badge role-badge--prog" title="Programmer">{ }</span>' : '') +
        '</div>' +
        '<div class="profile-handle">@' + u.handle + '</div>' +
      '</div>' +
      (u.bio ? '<p class="profile-bio">' + u.bio + '</p>' : '') +
      '<div class="profile-meta">' +
        (u.location ? '<span>' + icon('pin',      { size: 14, className: 'icon--inline' }) + u.location + '</span>' : '') +
        (u.joined   ? '<span>' + icon('calendar', { size: 14, className: 'icon--inline' }) + 'Joined ' + u.joined + '</span>' : '') +
        (ghLink ? '<a class="profile-gh" href="' + ghLink + '" target="_blank" rel="noopener">' +
                    icon('github', { size: 14, fill: true, className: 'icon--inline' }) + (u.github.handle || '') + '</a>' : '') +
      '</div>' +
      '<div class="profile-stats">' +
        '<span><b>' + (u.following || 0) + '</b> Following</span>' +
        '<span><b>' + (u.followers || 0) + '</b> Followers</span>' +
        '<span><b>' + postCount + '</b> Posts</span>' +
      '</div>' +
    '</header>'
  );

  const tabs = (
    '<div class="timeline__head">' +
      '<a class="tab is-active" href="' + url('/' + handle) + '">Posts</a>' +
      '<a class="tab" href="' + url('/' + handle) + '">Replies</a>' +
      '<a class="tab" href="' + url('/' + handle) + '">Spots</a>' +
      '<a class="tab" href="' + url('/' + handle) + '">Likes</a>' +
    '</div>'
  );

  const body = list.length
    ? list.map(renderPost).join('')
    : '<div class="stub"><p class="stub__sub">まだ投稿がありません。</p></div>';

  return header + tabs + body;
}
