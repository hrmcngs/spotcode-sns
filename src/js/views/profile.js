import { getUser, postsByHandle, likedPostsByHandle } from '../data.js';
import { renderPost }              from '../post.js';
import { url }                     from '../router.js';
import { currentUser }             from '../auth.js';
import { icon }                    from '../icons.js';
import { isFollowing, isRequested, followerCount, followingCount,
         hydratePostLikes, hydrateRepostsMine, hydrateBookmarksMine, hydratePolls,
         hydrateProfileFollow } from '../interactions.js';
import { hydrateQuotedPosts, cachedPosts } from '../data.js';
import { renderTimelineSkeleton } from '../skeleton.js';
import { quickNavLinks } from '../quick-nav.js';
import { renderAvatar } from '../avatar.js';
import { fetchProfileByHandle } from '../profiles.js';
import { t } from '../i18n.js';
import { renderGrass } from '../grass.js';
import { fetchContributions, cachedContributions } from '../github-activity.js';

// Monotonic version so async hydrations can detect a newer renderProfile
// has superseded them and bail out before clobbering the DOM.
let renderVersion = 0;

function escAttr(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// Normalise a website URL for display: hide the protocol so the row
// stays scannable. The link itself still points at the real URL.
function prettyUrl(u) {
  try {
    const url = new URL(u);
    return (url.host + url.pathname + url.search).replace(/\/$/, '');
  } catch { return u; }
}

// Render the row of social links shown under the profile-meta line.
// Empty when the user has set none, so existing profiles render the
// same as before this PR.
function renderProfileLinks(u) {
  const links = [];
  if (u.website) {
    const href = /^https?:\/\//i.test(u.website) ? u.website : 'https://' + u.website;
    links.push(
      '<a class="profile-link" href="' + escAttr(href) + '" target="_blank" rel="noopener nofollow">' +
        icon('globe', { size: 14, className: 'icon--inline' }) +
        '<span>' + escAttr(prettyUrl(href)) + '</span>' +
      '</a>'
    );
  }
  if (u.twitter) {
    links.push(
      '<a class="profile-link" href="https://x.com/' + escAttr(u.twitter) + '" target="_blank" rel="noopener nofollow">' +
        icon('twitter', { size: 14, className: 'icon--inline' }) +
        '<span>@' + escAttr(u.twitter) + '</span>' +
      '</a>'
    );
  }
  if (u.instagram) {
    links.push(
      '<a class="profile-link" href="https://instagram.com/' + escAttr(u.instagram) + '" target="_blank" rel="noopener nofollow">' +
        icon('instagram', { size: 14, className: 'icon--inline' }) +
        '<span>@' + escAttr(u.instagram) + '</span>' +
      '</a>'
    );
  }
  if (!links.length) return '';
  return '<div class="profile-links">' + links.join('') + '</div>';
}

// Member list for organization accounts. The `org_members` column was
// originally the "same-org audience" allowlist on personal accounts;
// on an `is_org` profile it doubles as the public roster the org
// publishes. Empty + non-owner viewer → render nothing so we don't
// pollute the layout with a blank section.
function renderOrgMembers(u) {
  if (!u.isOrg) return '';
  const me = currentUser();
  const isOwner = me && me.handle === u.handle;
  const handles = Array.isArray(u.orgMembers) ? u.orgMembers : [];
  if (!handles.length && !isOwner) return '';
  if (!handles.length) {
    return (
      '<section class="profile-members" id="profile-members-' + u.handle + '">' +
        '<h3 class="profile-members__title">' + t('profile.org_members.title') +
          ' <span class="profile-members__count">0</span>' +
        '</h3>' +
        '<p class="profile-members__empty">' + t('profile.org_members.empty_owner') + '</p>' +
      '</section>'
    );
  }
  // GitHub-org-style: compact avatar-only tiles with the name as a
  // hover tooltip. The CSS hides .profile-members__text on this
  // variant so the avatar grid stays tight (GitHub's "People" panel
  // is just rounded-square avatars in a 7-wide grid).
  return (
    '<section class="profile-members profile-members--gh" id="profile-members-' + u.handle + '">' +
      '<h3 class="profile-members__title">' + t('profile.org_members.title') +
        ' <span class="profile-members__count">' + handles.length + '</span>' +
      '</h3>' +
      '<div class="profile-members__grid">' +
        handles.map(h => {
          const m = getUser(h) || { handle: h, name: h, avatar: (h[0] || '?').toUpperCase() };
          // Force square avatar to mirror GitHub's people tile look.
          const tile = Object.assign({}, m, { avatarShape: 'square' });
          const label = (m.name && m.name !== h) ? (m.name + ' (@' + h + ')') : ('@' + h);
          return (
            '<a class="profile-members__row" href="' + url('/' + h) + '" title="' + escAttr(label) + '" aria-label="' + escAttr(label) + '">' +
              renderAvatar(tile, { size: 'md' }) +
              '<span class="profile-members__text">' +
                '<span class="profile-members__name">' + escAttr(m.name || h) + '</span>' +
                '<span class="profile-members__handle">@' + escAttr(h) + '</span>' +
              '</span>' +
            '</a>'
          );
        }).join('') +
      '</div>' +
    '</section>'
  );
}

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
    '</div>' +
    quickNavLinks()
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

  // GitHub-org-style header: square avatar, "Organization" subtitle in
  // place of the small inline badge, and a header modifier class the
  // CSS uses to swap in a compact People grid. Personal accounts get
  // the original layout — only `is_org` profiles change.
  const orgU = u.isOrg ? Object.assign({}, u, { avatarShape: 'square' }) : u;
  const header = (
    '<header class="profile-header' + (u.isOrg ? ' profile-header--org' : '') + '">' +
      '<div class="profile-cover"></div>' +
      '<div class="profile-top">' +
        renderAvatar(orgU, { size: 'xl' }) +
        '<div class="profile-top__actions">' +
          // Logout moved off the profile page — it now lives in the
          // right-click menu on the sidebar account card.
          (isMe
            ? '<button class="btn btn--primary" id="edit-profile-btn">' + t('profile.btn.edit') + '</button>'
            : '<button class="btn btn--ghost" id="profile-more-btn" data-profile-more="' + u.handle + '" aria-haspopup="menu" aria-expanded="false">' + t('profile.btn.more') + '</button>' +
              '<button class="btn ' + followBtnCls + ' btn--follow" data-target="' + u.handle + '">' +
                followBtnLabel +
              '</button>') +
        '</div>' +
      '</div>' +
      '<div class="profile-id">' +
        '<div class="profile-name">' + u.name +
          // {} badge for anyone with a linked GitHub handle, not
          // just users whose role column is explicitly 'programmer'
          // — older accounts (or anyone who picked 'general' at
          // sign-up but still linked their GitHub) were never
          // getting it, which made the badge look broken on most
          // active profiles.
          ((u.role === 'programmer' || u.github?.handle)
            ? ' <span class="role-badge role-badge--prog" title="Programmer">{ }</span>'
            : '') +
        '</div>' +
        (u.isOrg
          ? '<div class="profile-org-subtitle">' +
              icon('building', { size: 14, className: 'icon--inline' }) +
              t('profile.badge.org') +
            '</div>'
          : '') +
        '<div class="profile-handle">@' + u.handle +
          (u.isPrivate ? ' <span class="profile-lock" title="非公開アカウント">' + icon('lock', { size: 12, className: 'icon--inline' }) + '</span>' : '') +
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
      renderProfileLinks(u) +
      '<div class="profile-stats">' +
        '<a href="' + url('/' + u.handle + '/following') + '"><b>' + followingN + '</b> ' + t('profile.stat.following') + '</a>' +
        '<a href="' + url('/' + u.handle + '/followers') + '"><b>' + followersN + '</b> ' + t('profile.stat.followers') + '</a>' +
        '<span><b id="profile-postcount">…</b> ' + t('profile.stat.posts') + '</span>' +
      '</div>' +
      renderOrgMembers(u) +
      (u.github?.handle
        ? '<div class="profile-activity" id="profile-activity-' + u.handle + '" data-gh="' + u.github.handle + '">' +
            '<div class="profile-activity__head">' +
              icon('github', { size: 12, fill: true, className: 'icon--inline' }) +
              ' GitHub activity ' +
              '<span class="profile-activity__hint">last 12 months</span>' +
            '</div>' +
            '<div class="profile-activity__graph">' +
              renderGrass(cachedContributions(u.github.handle) || emptyGrid()) +
            '</div>' +
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

  const cached = activeTab === 'posts' ? cachedPosts('handle:' + handle) : null;
  const initial = (cached && cached.length)
    ? cached.map(renderPost).join('')
    : renderTimelineSkeleton(3);
  const body = '<div id="profile-posts">' + initial + '</div>';

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
  hydrateOrgMembers(handle).catch(() => {});
  await hydrateProfileBody(handle, renderVersion);
}

// For org accounts: members are listed by handle only; fetch the full
// profile for any that aren't in the local cache so the row paints
// the right avatar + display name instead of a handle-only stub.
async function hydrateOrgMembers(handle) {
  const u = getUser(handle);
  if (!u || !u.isOrg) return;
  const handles = Array.isArray(u.orgMembers) ? u.orgMembers : [];
  if (!handles.length) return;
  const missing = handles.filter(h => {
    const m = getUser(h);
    return !m || (!m.avatarImage && (!m.name || m.name === h));
  });
  if (!missing.length) return;
  await Promise.allSettled(missing.map(h => fetchProfileByHandle(h)));
  // Repaint just the members section so the rest of the profile
  // isn't disturbed mid-tab-load.
  const sec = document.getElementById('profile-members-' + u.handle);
  if (!sec) return;
  const fresh = getUser(handle);
  if (!fresh) return;
  const html = renderOrgMembers(fresh);
  if (html) sec.outerHTML = html;
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
        '<h2 class="stub__title">' + icon('lock', { size: 18, className: 'icon--inline' }) + 'このアカウントは非公開です</h2>' +
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
  const ids = posts.map(p => p.id);
  try {
    await Promise.all([
      hydratePostLikes(ids),
      hydrateRepostsMine(ids),
      hydrateBookmarksMine(ids),
      hydrateQuotedPosts(posts),
    ]);
  } catch (err) { console.warn('hydrate batch (profile)', err); return; }
  if (myVersion !== renderVersion) return;
  list.innerHTML = posts.map(renderPost).join('');
  hydratePolls(posts).catch(() => {});
}

// Per-handle dedupe for both badge and activity hydration. main.js's
// `onAuthChange → refresh()` re-runs dispatch() on every auth-state
// event (INITIAL_SESSION + SIGNED_IN can both fire on a single boot),
// which re-rendered the profile and re-triggered hydration each
// time. The activity grass replaced `slot.innerHTML` on each call →
// visible flicker. Badges meanwhile got removed via `slot.remove()`
// on the first run and stayed gone (because the new render shell
// didn't include the section once it had been hidden by an earlier
// "no badges" outcome). Caching keeps the DOM stable.
// Dedupe lives on the DOM slot via `data-hydrating` rather than on a
// module-scoped Map keyed by handle. The Map version persisted
// across SPA navigations, so visiting /aya → /hrmcngs → /aya the
// second time saw `hydratedBadges.has('aya') === 'done'` and skipped
// hydration entirely, leaving the freshly-rendered placeholder
// stuck on "バッジを取得中…" forever. Per-slot state automatically
// resets when renderProfile blows away the DOM, which is what we
// want for both the navigation case and the onAuthChange re-render
// case (same DOM = same dedupe; new DOM = re-run).

// (Removed — the skill-badges feature was dropped wholesale.
// hydrateProfileBadges + renderBadgeMedal + the click-opened
// detail modal all lived here.)

// (Removed resetProfileHydrationCache — dedupe now lives on the DOM
// slot's dataset, which resets automatically on each renderProfile
// re-render. No module-level map left to clear.)

// "More" popover handler. Wired from main.js's delegated click
// listener (`#profile-more-btn`). Mounts a singleton menu the first
// time it's needed and positions it under the button. Two actions:
//   - Copy profile link → navigator.clipboard
//   - Report user → confirm + prompt for a free-text reason, then
//     write to localStorage `spotcode:user-reports` so operators can
//     review later. (Schema-backed reporting is a follow-up.)
let moreMenuEl = null;
function ensureMoreMenu() {
  if (moreMenuEl) return moreMenuEl;
  moreMenuEl = document.createElement('div');
  moreMenuEl.className = 'profile-more-menu';
  moreMenuEl.setAttribute('role', 'menu');
  moreMenuEl.hidden = true;
  document.body.appendChild(moreMenuEl);
  document.addEventListener('click', (e) => {
    if (!moreMenuEl || moreMenuEl.hidden) return;
    if (moreMenuEl.contains(e.target)) return;
    if (e.target.closest('[data-profile-more]')) return;
    closeMoreMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && moreMenuEl && !moreMenuEl.hidden) closeMoreMenu();
  });
  return moreMenuEl;
}
function closeMoreMenu() {
  if (!moreMenuEl) return;
  moreMenuEl.hidden = true;
  const trigger = document.getElementById('profile-more-btn');
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
}
export function openProfileMore(handle, anchor) {
  const menu = ensureMoreMenu();
  menu.innerHTML =
    '<button type="button" class="profile-more-menu__item" data-more-action="copy">' +
      icon('share', { size: 14, className: 'icon--inline' }) +
      t('profile.more.copy_link') +
    '</button>' +
    '<button type="button" class="profile-more-menu__item profile-more-menu__item--bad" data-more-action="report">' +
      icon('flag', { size: 14, className: 'icon--inline' }) +
      t('profile.more.report') +
    '</button>';
  const r = anchor.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top  = (r.bottom + 6) + 'px';
  menu.style.left = Math.max(8, r.right - 220) + 'px';
  menu.hidden = false;
  if (anchor.setAttribute) anchor.setAttribute('aria-expanded', 'true');

  menu.onclick = async (e) => {
    const btn = e.target.closest('[data-more-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-more-action');
    closeMoreMenu();
    if (action === 'copy') {
      const link = location.origin + url('/' + handle);
      try {
        await navigator.clipboard.writeText(link);
        toast(t('profile.more.copied'));
      } catch {
        // Fallback for browsers without clipboard API access (older
        // Safari without HTTPS, etc.) — show the link in a prompt so
        // the user can copy manually.
        prompt(t('profile.more.copy_manual'), link);
      }
    } else if (action === 'report') {
      const me = currentUser();
      if (!me) return;
      if (!confirm(t('profile.more.report_confirm').replace('{handle}', handle))) return;
      const reason = prompt(t('profile.more.report_prompt')) || '';
      if (!reason.trim()) return;
      try {
        const KEY = 'spotcode:user-reports';
        const list = JSON.parse(localStorage.getItem(KEY) || '[]');
        list.push({
          target: handle,
          reporter: me.handle,
          reason: reason.trim().slice(0, 400),
          ts: Date.now(),
        });
        localStorage.setItem(KEY, JSON.stringify(list));
      } catch {}
      toast(t('profile.more.report_sent'));
    }
  };
}

// Lightweight non-blocking toast — single shared element, fades after
// 2s. The popover uses it for "リンクをコピーしました" / "通報を受け
// 付けました" so the user gets visible feedback without a modal.
let toastEl = null;
function toast(text) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'profile-toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = text;
  toastEl.classList.add('is-show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove('is-show'), 2000);
}

// Same idea for the GitHub contributions heatmap: render the empty grid
// inline (renderProfile already does that), then fill it in once the
// API answers. Cached for an hour so revisits are instant.
export async function hydrateProfileActivity(handle) {
  const u = getUser(handle);
  const gh = u?.github?.handle;
  if (!gh) return;
  const slot = document.querySelector('#profile-activity-' + u.handle + ' .profile-activity__graph');
  if (!slot) return;
  // Same per-slot dedupe pattern as hydrateProfileBadges — survives
  // re-renders correctly because the dataset attaches to the DOM
  // element, not to the handle.
  if (slot.dataset.hydrating === '1') return;
  slot.dataset.hydrating = '1';
  try {
    const cached = cachedContributions(gh);
    if (!cached) {
      const counts = await fetchContributions(gh);
      if (!counts) return;
    }
    const counts = cachedContributions(gh);
    if (counts) slot.innerHTML = renderGrass(counts);
  } finally {
    if (slot.isConnected) delete slot.dataset.hydrating;
  }
}
