import { getUser, postsByHandle, likedPostsByHandle } from '../data.js';
import { renderPost }              from '../post.js';
import { url }                     from '../router.js';
import { currentUser }             from '../auth.js';
import { icon }                    from '../icons.js';
import { isFollowing, isRequested, followerCount, followingCount,
         hydratePostLikes, hydrateProfileFollow } from '../interactions.js';
import { getBadges } from '../badges.js';
import { renderAvatar } from '../avatar.js';
import { fetchProfileByHandle } from '../profiles.js';
import { t } from '../i18n.js';
import { renderGrass } from '../grass.js';
import { fetchContributions, cachedContributions } from '../github-activity.js';

// Monotonic version so async hydrations can detect a newer renderProfile
// has superseded them and bail out before clobbering the DOM.
let renderVersion = 0;

// 53 weeks × 7 days of zeros — gives renderGrass() something to paint
// while we wait for the real GitHub data to come back.
function emptyGrid() {
  const out = {};
  for (let i = 0; i < 53 * 7; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    out[d.toISOString().slice(0, 10)] = 0;
  }
  return out;
}

// In-memory current tab per profile view. Not in the URL — clicking a tab
// stays on /<handle> but swaps the body via hydrateProfileBody().
let activeTab = 'posts';
const TABS = ['posts', 'spots', 'likes'];
function tabLabel(key) { return t('profile.tab.' + key); }

function notFound(handle) {
  return (
    '<div class="stub">' +
      '<h2 class="stub__title">@' + handle + ' ' + t('profile.not_found.title') + '</h2>' +
      '<p class="stub__sub">' + t('profile.not_found.sub') + '</p>' +
      '<a class="back-home" href="/">' + t('profile.back') + '</a>' +
    '</div>'
  );
}

function loading(handle) {
  return (
    '<div class="stub" id="profile-loading">' +
      '<h2 class="stub__title">@' + handle + '</h2>' +
      '<p class="stub__sub">' + t('profile.loading') + '</p>' +
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
  const followed   = me && !isMe && isFollowing(me.handle, u.handle);
  const requested  = me && !isMe && isRequested(me.handle, u.handle);
  // Follow-button text/style depends on (target privacy) × (current state).
  const followBtnLabel = followed   ? 'Following'
                       : requested  ? 'Requested'
                       : u.isPrivate ? 'Request'
                       :              'Follow';
  const followBtnCls   = (followed || requested) ? 'btn--ghost is-following' : 'btn--primary';

  const header = (
    '<header class="profile-header">' +
      '<div class="profile-cover"></div>' +
      '<div class="profile-top">' +
        renderAvatar(u, { size: 'xl' }) +
        '<div class="profile-top__actions">' +
          (isMe
            ? '<button class="btn btn--ghost" id="logout-btn">' + t('nav.logout') + '</button>' +
              '<button class="btn btn--primary" id="edit-profile-btn">' + t('profile.btn.edit') + '</button>'
            : '<button class="btn btn--ghost">' + t('profile.btn.more') + '</button>' +
              '<button class="btn ' + followBtnCls + ' btn--follow" data-target="' + u.handle + '">' +
                followBtnLabel +
              '</button>') +
        '</div>' +
      '</div>' +
      '<div class="profile-id">' +
        '<div class="profile-name">' + u.name +
          (u.role === 'programmer' ? ' <span class="role-badge role-badge--prog" title="Programmer">{ }</span>' : '') +
        '</div>' +
        '<div class="profile-handle">@' + u.handle +
          (u.isPrivate ? ' <span class="profile-lock" title="非公開アカウント">🔒</span>' : '') +
        '</div>' +
      '</div>' +
      (u.bio ? '<p class="profile-bio">' + u.bio + '</p>' : '') +
      '<div class="profile-meta">' +
        (u.location ? '<span>' + icon('pin',      { size: 14, className: 'icon--inline' }) + u.location + '</span>' : '') +
        (u.joined   ? '<span>' + icon('calendar', { size: 14, className: 'icon--inline' }) + t('profile.joined') + u.joined + '</span>' : '') +
        (ghLink ? '<a class="profile-gh" href="' + ghLink + '" target="_blank" rel="noopener" title="' +
                    (u.github?.verified ? '本人確認済み' : '未確認') + '">' +
                    icon('github', { size: 14, fill: true, className: 'icon--inline' }) + (u.github.handle || '') +
                    (u.github?.verified ? ' <span class="gh-verified" title="本人確認済み">✓</span>' : '') +
                  '</a>' : '') +
      '</div>' +
      '<div class="profile-stats">' +
        '<a href="' + url('/' + u.handle + '/following') + '"><b>' + followingN + '</b> ' + t('profile.stat.following') + '</a>' +
        '<a href="' + url('/' + u.handle + '/followers') + '"><b>' + followersN + '</b> ' + t('profile.stat.followers') + '</a>' +
        '<span><b id="profile-postcount">…</b> ' + t('profile.stat.posts') + '</span>' +
      '</div>' +
      (u.github?.handle
        ? '<div class="profile-badges" id="profile-badges-' + u.handle + '" data-gh="' + u.github.handle + '">' +
            '<span class="profile-badges__loading">バッジを取得中…</span>' +
          '</div>'
        : '') +
      (u.github?.handle
        ? '<div class="profile-activity" id="profile-activity-' + u.handle + '" data-gh="' + u.github.handle + '">' +
            '<div class="profile-activity__head">' +
              icon('github', { size: 12, fill: true, className: 'icon--inline' }) +
              ' GitHub activity ' +
              '<span class="profile-activity__hint">last 12 months</span>' +
            '</div>' +
            // Filled by hydrateProfileActivity (or just stays as the
            // placeholder if the fetch fails / GitHub handle is bogus).
            '<div class="profile-activity__graph">' + renderGrass(emptyGrid()) + '</div>' +
          '</div>'
        : '') +
    '</header>'
  );

  const tabs = (
    '<div class="timeline__head">' +
      TABS.map(key => (
        '<button type="button" class="tab' + (key === activeTab ? ' is-active' : '') + '" ' +
          'data-profile-tab="' + key + '" data-profile-handle="' + handle + '">' +
          tabLabel(key) +
        '</button>'
      )).join('') +
    '</div>'
  );

  const body = (
    '<div id="profile-posts">' +
      '<div class="stub"><p class="stub__sub">' + t('spot.loading') + '</p></div>' +
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
  const isMe = me && me.handle === handle;
  // Always go to Supabase for other users' profiles so their avatar /
  // bio / shape changes propagate without waiting for a session reset.
  // For your own profile, currentUser() is already the freshest source.
  if (!isMe) {
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
  // Reset the tab to Posts whenever a fresh profile is opened so the new
  // page never inherits the active tab of the previous one.
  activeTab = 'posts';
  const app = document.getElementById('app');
  if (app) app.innerHTML = renderProfile(handle);
  // renderProfile bumped renderVersion — capture the new value for the
  // body hydration below.
  await hydrateProfileBody(handle, renderVersion);
}

// Called from main.js when the user clicks one of the profile tabs.
// Updates the active tab, swaps the is-active class, and refetches the
// body for the new tab.
export async function setProfileTab(handle, tab) {
  if (!TABS.includes(tab) || tab === activeTab) return;
  activeTab = tab;
  document.querySelectorAll('[data-profile-tab]').forEach(el => {
    el.classList.toggle('is-active', el.getAttribute('data-profile-tab') === tab);
  });
  const list = document.getElementById('profile-posts');
  if (list) list.innerHTML = '<div class="stub"><p class="stub__sub">' + t('follow.loading') + '</p></div>';
  await hydrateProfileBody(handle, renderVersion);
}

async function hydrateProfileBody(handle, myVersion) {
  const list = document.getElementById('profile-posts');
  if (!list) return;

  // Private accounts: if the viewer isn't the owner and isn't an
  // accepted follower, the Posts RLS already drops their rows so we'd
  // just paint the generic empty state. Give a clearer message instead.
  const u = getUser(handle);
  const me = currentUser();
  const blockedByPrivacy = u && u.isPrivate
    && (!me || (me.handle !== handle && !isFollowing(me.handle, handle)));
  if (blockedByPrivacy) {
    const requested = me && isRequested(me.handle, handle);
    list.innerHTML =
      '<div class="stub">' +
        '<h2 class="stub__title">🔒 このアカウントは非公開です</h2>' +
        '<p class="stub__sub">' +
          (requested
            ? '<strong>承認待ち</strong>です。@' + handle + ' が承認すると投稿が見られるようになります。'
            : 'フォローして承認されると投稿が見られるようになります。') +
        '</p>' +
      '</div>';
    const countEl = document.getElementById('profile-postcount');
    if (countEl) countEl.textContent = '?';
    return;
  }

  const tab = activeTab;
  let posts;
  try {
    if (tab === 'likes')      posts = await likedPostsByHandle(handle);
    else if (tab === 'spots') posts = (await postsByHandle(handle)).filter(p => p.spot);
    else                      posts = await postsByHandle(handle);
  } catch (err) {
    if (myVersion !== renderVersion) return;
    console.error('hydrateProfileBody', err);
    list.innerHTML = '<div class="stub"><p class="stub__sub">取得に失敗しました: ' + (err.message || '') + '</p></div>';
    return;
  }
  if (myVersion !== renderVersion) return;
  // Only the Posts tab drives the header "Posts" count.
  if (tab === 'posts') {
    const countEl = document.getElementById('profile-postcount');
    if (countEl) countEl.textContent = String(posts.length);
  }
  if (!posts.length) {
    const empty = tab === 'likes' ? t('profile.empty.likes')
                : tab === 'spots' ? t('profile.empty.spots')
                :                   t('profile.empty.posts');
    list.innerHTML = '<div class="stub"><p class="stub__sub">' + empty + '</p></div>';
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

// Same idea for the GitHub contributions heatmap: render the empty grid
// inline (renderProfile already does that), then fill it in once the
// API answers. Cached for an hour so revisits are instant.
export async function hydrateProfileActivity(handle) {
  const u = getUser(handle);
  const gh = u?.github?.handle;
  if (!gh) return;
  const cached = cachedContributions(gh);
  if (!cached) {
    const counts = await fetchContributions(gh);
    if (!counts) return;
  }
  // Re-render the graph with whatever the cache holds now.
  const slot = document.querySelector('#profile-activity-' + u.handle + ' .profile-activity__graph');
  if (!slot) return;
  const counts = cachedContributions(gh);
  if (counts) slot.innerHTML = renderGrass(counts);
}
