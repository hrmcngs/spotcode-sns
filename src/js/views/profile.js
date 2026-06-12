import { getUser, postsByHandle } from '../data.js';
import { renderPost }              from '../post.js';
import { url }                     from '../router.js';
import { currentUser }             from '../auth.js';
import { icon }                    from '../icons.js';
import { isFollowing, followerCount, followingCount,
         hydratePostLikes, hydrateProfileFollow } from '../interactions.js';
import { getBadges } from '../badges.js';
import { renderAvatar } from '../avatar.js';
import { fetchProfileByHandle } from '../profiles.js';

// Monotonic version so async hydrations can detect a newer renderProfile
// has superseded them and bail out before clobbering the DOM.
let renderVersion = 0;

function notFound(handle) {
  return (
    '<div class="stub">' +
      '<h2 class="stub__title">@' + handle + ' is empty here</h2>' +
      '<p class="stub__sub">このアカウントは存在しないか、まだ何も投稿していません。</p>' +
      '<a class="back-home" href="/">← Back to home</a>' +
    '</div>'
  );
}

function loading(handle) {
  return (
    '<div class="stub" id="profile-loading">' +
      '<h2 class="stub__title">@' + handle + '</h2>' +
      '<p class="stub__sub">プロフィールを読み込み中…</p>' +
    '</div>'
  );
}

export function renderProfile(handle) {
  renderVersion++;
  const u = getUser(handle);
  // No local cache yet — show a loading skeleton; hydrateProfile() will
  // fetch from Supabase and re-render this card.
  if (!u) return loading(handle);

  const me = currentUser();
  const isMe = me && me.handle === u.handle;
  const ghLink = u.github?.url || (u.github?.handle ? 'https://github.com/' + u.github.handle : null);
  // Counts come from Supabase via hydrateProfileFollow; the cache returns
  // 0 until then, which is fine — hydrateProfile re-renders after fill.
  const followingN = followingCount(u.handle);
  const followersN = followerCount(u.handle);
  const followed = me && !isMe && isFollowing(me.handle, u.handle);

  const header = (
    '<header class="profile-header">' +
      '<div class="profile-cover"></div>' +
      '<div class="profile-top">' +
        renderAvatar(u, { size: 'xl' }) +
        '<div class="profile-top__actions">' +
          (isMe
            ? '<button class="btn btn--ghost" id="logout-btn">Log out</button>' +
              '<button class="btn btn--primary" id="edit-profile-btn">Edit profile</button>'
            : '<button class="btn btn--ghost">More</button>' +
              '<button class="btn ' + (followed ? 'btn--ghost is-following' : 'btn--primary') + ' btn--follow" data-target="' + u.handle + '">' +
                (followed ? 'Following' : 'Follow') +
              '</button>') +
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
        '<span><b>' + followingN + '</b> Following</span>' +
        '<span><b>' + followersN + '</b> Followers</span>' +
        '<span><b id="profile-postcount">…</b> Posts</span>' +
      '</div>' +
      (u.github?.handle
        ? '<div class="profile-badges" id="profile-badges-' + u.handle + '" data-gh="' + u.github.handle + '">' +
            '<span class="profile-badges__loading">バッジを取得中…</span>' +
          '</div>'
        : '') +
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

  const body = (
    '<div id="profile-posts">' +
      '<div class="stub"><p class="stub__sub">投稿を読み込み中…</p></div>' +
    '</div>'
  );

  return header + tabs + body;
}

// Look up the profile + follow counts in Supabase if needed, render the
// finalised profile shell, then hydrate the posts list. 404 → notFound.
// Every DOM write is gated on `renderVersion` so a newer navigation
// can't be silently overwritten by a stale fetch.
export async function hydrateProfile(handle) {
  const myVersion = renderVersion;
  const me = currentUser();
  const haveLocal = (me && me.handle === handle) || getUser(handle)?._fetched;
  if (!haveLocal) {
    let fetched;
    try { fetched = await fetchProfileByHandle(handle); }
    catch (err) {
      if (myVersion !== renderVersion) return;
      const app = document.getElementById('app');
      if (app) app.innerHTML = '<div class="stub"><h2 class="stub__title">読み込みに失敗しました</h2><p class="stub__sub">' + (err.message || '') + '</p></div>';
      return;
    }
    if (myVersion !== renderVersion) return;
    if (!fetched) {
      const app = document.getElementById('app');
      if (app) app.innerHTML = notFound(handle);
      return;
    }
  }
  await hydrateProfileFollow(handle);
  if (myVersion !== renderVersion) return;
  const app = document.getElementById('app');
  if (app) app.innerHTML = renderProfile(handle);
  // renderProfile bumped renderVersion — capture the new value for the
  // posts hydration below.
  await hydrateProfilePosts(handle, renderVersion);
}

async function hydrateProfilePosts(handle, myVersion) {
  const list = document.getElementById('profile-posts');
  if (!list) return;
  let posts;
  try { posts = await postsByHandle(handle); }
  catch (err) {
    if (myVersion !== renderVersion) return;
    console.error('hydrateProfilePosts', err);
    list.innerHTML = '<div class="stub"><p class="stub__sub">投稿の取得に失敗しました: ' + (err.message || '') + '</p></div>';
    return;
  }
  if (myVersion !== renderVersion) return;
  const countEl = document.getElementById('profile-postcount');
  if (countEl) countEl.textContent = String(posts.length);
  if (!posts.length) {
    list.innerHTML = '<div class="stub"><p class="stub__sub">まだ投稿がありません。</p></div>';
    return;
  }
  list.innerHTML = posts.map(renderPost).join('');
  try { await hydratePostLikes(posts.map(p => p.id)); }
  catch (err) { console.warn('hydratePostLikes (profile)', err); return; }
  if (myVersion !== renderVersion) return;
  list.innerHTML = posts.map(renderPost).join('');
}

// Resolves badges asynchronously after the profile is rendered, so the
// page paints immediately and we don't block on GitHub API.
export async function hydrateProfileBadges(handle) {
  const u = getUser(handle);
  if (!u || !u.github?.handle) return;
  const slot = document.getElementById('profile-badges-' + u.handle);
  if (!slot) return;
  try {
    const badges = await getBadges(u.github.handle);
    if (!badges.length) { slot.remove(); return; }
    slot.innerHTML = badges.map(b => (
      '<span class="badge-chip badge-chip--' + b.tone + '" title="' + b.tooltip.replace(/"/g, '&quot;') + '">' +
        b.name + '</span>'
    )).join('');
  } catch {
    slot.remove();
  }
}
