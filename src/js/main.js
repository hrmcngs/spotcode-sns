import { initThemeToggle } from './theme.js';
import { renderGrass }     from './grass.js';
import { onRoute, url, refresh, navigate, currentPath } from './router.js';
import { renderHome, hydrateHome } from './views/home.js';
import { renderProfile, hydrateProfileActivity, hydrateProfileLanguages, hydrateProfileTasks, hydrateProfile, setProfileTab, openProfileMore, handleTasksClick } from './views/profile.js';
import { renderRepos, hydrateRepos } from './views/repos.js';
import { renderSpot, hydrateSpot } from './views/spot.js';
import { renderMap, hydrateMap }  from './views/map.js';
// /requests folded into /notifications (follow_request rows have
// inline Accept/Deny). Old `requests.js` is dead weight kept only for
// the off chance someone re-introduces a dedicated requests page.
import { renderNotifications, hydrateNotifications, handleNotifAction } from './views/notifications.js';
import { renderPostDetail, hydratePostDetail, handleCommentDelete } from './views/post-detail.js';
import { renderPostAnalytics, hydratePostAnalytics } from './views/post-analytics.js';
import { renderFollowList, hydrateFollowList } from './views/follow-list.js';
import { renderSettings, bindSettings } from './views/settings.js';
import { pickSpot }        from './views/spot-picker.js';
import { openAuth }        from './views/auth-modal.js';
import { openEditProfile } from './views/edit-profile-modal.js';
import { openReport }      from './views/report-modal.js';
import { initSearch }      from './views/search-dropdown.js';
import { allUsers, allPosts, cachedPosts, addPost, removePost, updatePost, probeSchema, prependToTimelineCaches,
         markPendingDelete, unmarkPendingDelete } from './data.js';
import { currentUser, logout, onAuthChange, initAuth, listSavedAccounts, switchAccount } from './auth.js';
import { getOfficialAccount, cachedOfficialAccount, OFFICIAL_HANDLE } from './official-account.js';
import { isAdmin, isOperator } from './dev-mode.js';
import { onPrivacyModeChange, maskHandle, maskName } from './privacy-mode.js';
import { isPostingAsOfficial, setPostingAsOfficial, onPostingIdentityChange, displayUser } from './posting-identity.js';
import { icon }            from './icons.js';
import { toggleLike, isLiked, likeCount,
         toggleFollow, isFollowing,
         toggleRepost, toggleBookmark,
         hydrateMyFollows, myFollowingHandles, clearInteractionsCache,
         hydrateOfficialFollows, isOfficialFollowing } from './interactions.js';
import { renderAvatar, fileToPhotoDataUrl } from './avatar.js';
import { initDevMode, isDevMode } from './dev-mode.js';
import { applyDisplayPrefs } from './display-prefs.js';
import { romajiToJp, jpToRomaji } from './jp-romaji.js';
import { initI18n, t }            from './i18n.js';
import { initIosZoomGuard }       from './ios-zoom.js';
import { lockBodyScroll, unlockBodyScroll, forceUnlockBodyScroll } from './body-scroll-lock.js';
import { fetchContributions, cachedContributions } from './github-activity.js';
import { recommendedProfiles } from './profiles.js';
import { saveDraft, loadDraft, clearDraft, debounce } from './drafts.js';
import { quickNavLinks } from './quick-nav.js';
import { initMentionAutocomplete } from './mention-autocomplete.js';
import { parseConnpassUrl } from './connpass.js';

const app  = document.getElementById('app');
const rail = document.getElementById('rail');

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// Aggregate the actual posts by city (市区町村) for the right-rail
// "Trending spots" card. A post contributes when its spot includes
// `addressDetails.city`. Posts without a location are skipped.
// Reads the localStorage home-timeline cache synchronously — it used
// to fire its own 200-row Supabase query on every navigation, which
// was a major source of per-page lag. The cache is refilled by the
// home view's own fetch and by refreshRailData() below.
function computeTrendingCities() {
  const byCity = new Map(); // city -> { city, prefecture, count }
  const posts = cachedPosts('home') || [];
  for (const p of posts) {
    const det = p?.spot?.addressDetails;
    const city = det?.city;
    if (!city) continue;
    const prev = byCity.get(city);
    if (prev) prev.count++;
    else byCity.set(city, { city, prefecture: det.prefecture || '', count: 1 });
  }
  return [...byCity.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

// Empty-day grid for the activity heatmap when we don't have real data
// yet (logged-out, or fetching the GitHub contributions API). Renders as
// a grey placeholder until cached data shows up on a re-render.
const emptyCounts = {};
for (let i = 0; i < 53 * 7; i++) {
  const d = new Date(); d.setDate(d.getDate() - i);
  emptyCounts[d.toISOString().slice(0, 10)] = 0;
}

// ----- static icon slots that aren't view-rendered -----
document.getElementById('ic-search').innerHTML = icon('search', { size: 16 });
document.getElementById('ic-bell').innerHTML   = icon('bell',   { size: 20 });
document.getElementById('ic-gear').innerHTML   = icon('gear',   { size: 20 });
document.getElementById('theme-toggle').innerHTML = icon('moon', { size: 16 });
document.querySelector('#open-compose .compose-cta__ico').innerHTML = icon('plus', { size: 18 });
document.querySelectorAll('.side-nav__item').forEach(el => {
  const name = el.getAttribute('data-ico');
  if (name) el.insertAdjacentHTML('afterbegin', '<span class="side-nav__icon">' + icon(name, { size: 22 }) + '</span>');
});

// ----- right rail -----
// The rail used to await two Supabase round trips (recommended
// profiles + a 200-row post fetch for Trending) on EVERY route change
// before painting anything — the single biggest source of navigation
// lag. Now the rail paints synchronously from local caches on every
// nav, and the underlying data refreshes in the background at most
// once per RAIL_REFRESH_MS, repainting only if the HTML changed.
const RAIL_REFRESH_MS = 5 * 60 * 1000;
let railFetchedAt = 0;
let railFetching  = false;
let lastRailHtml  = null;

// The overlay identity to exclude from Who-to-follow (so
// @spotcode_official doesn't show up as a "follow me" suggestion to
// its own admin while they're posting as it).
function railOverlayHandle(me) {
  if (!me || !isPostingAsOfficial()) return null;
  const overlay = displayUser(me);
  return (overlay && overlay.handle !== me.handle) ? overlay.handle : OFFICIAL_HANDLE;
}

function repaintRail() {
  const html = buildRailHtml();
  if (html === lastRailHtml) return; // skip DOM churn when nothing changed
  lastRailHtml = html;
  rail.innerHTML = html;
}

// Background refresh of the rail's network-backed data (my follows,
// recommended profiles, and — first boot only — the home timeline
// that Trending reads from). Throttled; never blocks a paint.
function refreshRailData() {
  if (railFetching || Date.now() - railFetchedAt < RAIL_REFRESH_MS) return;
  railFetching = true;
  (async () => {
    try { await hydrateMyFollows(); } catch {}
    const me = currentUser();
    const overlayHandle = railOverlayHandle(me);
    const excludeHandles = [];
    if (me) {
      excludeHandles.push(me.handle);
      if (overlayHandle) excludeHandles.push(overlayHandle);
      try { excludeHandles.push(...myFollowingHandles()); } catch {}
    }
    try { await recommendedProfiles({ limit: 5, excludeHandles }); } catch {}
    // Trending reads cachedPosts('home'); if nothing has filled it yet
    // (first visit, landing on a non-home route) do one fetch here.
    if (!cachedPosts('home')) { try { await allPosts({ limit: 100 }); } catch {} }
    railFetchedAt = Date.now();
    railFetching  = false;
    repaintRail();
  })();
}

function buildRailHtml() {
  const me = currentUser();
  const overlayHandle = railOverlayHandle(me);
  const others = Object.values(allUsers()).filter(u => {
    if (!me) return true; // guest: don't hide anyone
    if (u.handle === me.handle) return false;
    if (overlayHandle && u.handle === overlayHandle) return false;
    return !isFollowing(me.handle, u.handle);
  });
  const trending = computeTrendingCities();

  // Pull the viewer's real GitHub contributions for the activity heatmap.
  // If they're not logged in, or haven't linked a github_handle, fall back
  // to the empty grid so the card still renders. Cached after first fetch.
  const gh = me?.github?.handle;
  const myCounts = gh ? (cachedContributions(gh) || emptyCounts) : emptyCounts;
  if (gh && !cachedContributions(gh)) {
    // Fetch in the background and repaint the rail once it lands
    // (rail only — a full refresh() re-renders the whole view).
    fetchContributions(gh).then((c) => { if (c) repaintRail(); });
  }

  const parts = [
    '<section class="card">',
      '<h3>' + t('rail.activity') + '</h3>',
      renderGrass(myCounts),
    '</section>',
  ];

  if (trending.length) {
    parts.push(
      '<section class="card">' +
        '<h3>' + t('rail.trending') + '</h3>' +
        '<div class="trend-list">' +
          trending.map((s, i) => (
            '<a class="trend-item" href="' + url('/spots/' + encodeURIComponent(jpToRomaji(s.city) || s.city)) + '">' +
              '<div class="trend-item__main">' +
                '<span class="trend-item__cat">Trending · #' + (i + 1) + '</span>' +
                '<span class="trend-item__name">' +
                  icon('pin', { size: 14, className: 'icon--inline' }) + escape(s.city) +
                '</span>' +
                (s.prefecture
                  ? '<span class="trend-item__sub">' + escape(s.prefecture) + '</span>'
                  : '') +
              '</div>' +
              '<span class="trend-item__count">' + s.count + ' ' +
                (s.count === 1 ? t('common.idea') : t('common.ideas')) +
              '</span>' +
            '</a>'
          )).join('') +
        '</div>' +
      '</section>'
    );
  }

  if (others.length) {
    parts.push(
      '<section class="card">' +
        '<h3>' + t('rail.who_to_follow') + '</h3>' +
        '<div class="followlist">' +
          others.slice(0, 5).map(u => {
            // While overlay is on, render the badge from the brand's
            // graph (officialFollows). Click goes through with
            // actorUserId = official.id (Stage 26 RLS allows it).
            const overlayOn = isPostingAsOfficial();
            const f = me && (overlayOn ? isOfficialFollowing(u.handle) : isFollowing(me.handle, u.handle));
            const displayName   = maskName(u.handle, u.name);
            const displayHandle = maskHandle(u.handle);
            return (
              '<div class="followlist__row">' +
                renderAvatar(u, { tag: 'a', href: url('/' + u.handle) }) +
                '<div class="followlist__text">' +
                  '<a class="followlist__name" href="' + url('/' + u.handle) + '" title="' + escape(displayName) + '">' + escape(displayName) + '</a>' +
                  '<a class="followlist__handle" href="' + url('/' + u.handle) + '">@' + displayHandle + '</a>' +
                '</div>' +
                '<button class="followlist__follow' + (f ? ' is-following' : '') + '" data-target="' + u.handle + '">' +
                  (f ? t('profile.btn.following') : t('profile.btn.follow')) +
                '</button>' +
              '</div>'
            );
          }).join('') +
        '</div>' +
      '</section>'
    );
  }
  return parts.join('');
}

function setActiveNav(path) {
  document.querySelectorAll('.side-nav__item').forEach(el => {
    const route = el.getAttribute('data-route');
    if (!route) { el.classList.remove('is-active'); return; }
    el.classList.toggle('is-active', route === path);
  });
}

function renderAuthArea() {
  const slot = document.getElementById('auth-area');
  if (!slot) return;
  const real = currentUser();
  if (real) {
    // When the "posting as official" overlay is on the topbar
    // avatar swaps to the brand avatar so the staffer always sees
    // which identity their next post will go out as.
    const me = displayUser(real);
    // Topbar avatar opens the account-switcher menu on click. The
    // sidebar Profile nav already covers "go to my profile", so the
    // avatar's job is the dropdown trigger (matches Twitter/X).
    slot.innerHTML = renderAvatar(me, {
      tag: 'a',
      href: url('/' + me.handle),
      size: 'me',
      title: me.name,
      extra: 'auth-area__avatar' + (isPostingAsOfficial() ? ' auth-area__avatar--official' : ''),
    });
    const a = slot.firstElementChild;
    if (a) a.setAttribute('data-account-menu', '1');
  } else {
    slot.innerHTML =
      '<button class="btn btn--primary btn--sm" data-auth="login">' + t('nav.login') + '</button>';
  }
}

function renderSideMe() {
  const slot = document.getElementById('side-me');
  if (!slot) return;
  const real = currentUser();
  // `me` is the overlay-aware identity: returns the official profile
  // when the "post as official" toggle is on, otherwise the real
  // user. Hoisted out of the `if (real)` block so the Profile link
  // logic below can read it too.
  const me = real ? displayUser(real) : null;
  if (me) {
    slot.innerHTML =
      '<a class="me-card" href="' + url('/' + me.handle) + '" data-account-menu="1">' +
        renderAvatar(me, { size: 'lg' }) +
        '<div class="me-card__text">' +
          '<div class="me-card__name">' + me.name + '</div>' +
          '<div class="me-card__handle">@' + me.handle + '</div>' +
        '</div>' +
      '</a>';
  } else {
    slot.innerHTML =
      '<button class="btn btn--ghost btn--block" data-auth="login">' + t('nav.login') + '</button>';
  }
  // Profile side-nav item: follows the overlay identity, so while
  // posting as official the Profile link jumps to @spotcode_official
  // instead of the staffer's own profile. (Matches the side-rail
  // me-card above, the topbar avatar, and the composer avatar.)
  const profileLink = document.querySelector('.side-nav__item[data-nav="profile"]');
  if (profileLink) {
    if (me) {
      profileLink.setAttribute('href', '/' + me.handle);
      profileLink.setAttribute('data-route', '/' + me.handle);
      profileLink.removeAttribute('data-auth');
    } else {
      profileLink.setAttribute('href', '/');
      profileLink.removeAttribute('data-route');
      profileLink.setAttribute('data-auth', 'login');
    }
  }
}

// Right-click on the sidebar me-card opens a small popover with the
// saved-accounts list (each row clickable to switch) and a "Log out"
// footer. The profile page's stand-alone logout button was removed
// once this existed — the right-click menu is the only entry point.
// Twitter-style modal. A single overlay element holds both the dim
// backdrop and the centred card; clicking the backdrop (or the X
// button, or pressing Escape) closes it. Uses an `is-open` class
// for show/hide so no [hidden] CSS override can break it.
let accountMenuRoot = null;
function ensureAccountMenu() {
  if (accountMenuRoot) return accountMenuRoot;
  accountMenuRoot = document.createElement('div');
  accountMenuRoot.className = 'account-menu-overlay';
  accountMenuRoot.setAttribute('role', 'dialog');
  accountMenuRoot.setAttribute('aria-modal', 'true');
  document.body.appendChild(accountMenuRoot);
  // Backdrop click → close. The card stops propagation so clicks
  // inside don't bubble to the backdrop's handler.
  accountMenuRoot.addEventListener('click', (e) => {
    if (e.target === accountMenuRoot) closeAccountMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && accountMenuRoot.classList.contains('is-open')) {
      closeAccountMenu();
    }
  });
  return accountMenuRoot;
}
function closeAccountMenu() {
  if (accountMenuRoot) accountMenuRoot.classList.remove('is-open');
  document.documentElement.classList.remove('account-menu-locked');
}
function openAccountMenu(anchorRect) {
  const me = currentUser();
  if (!me) return;
  const root = ensureAccountMenu();
  const saved = listSavedAccounts();
  // "Posting as official" is an identity overlay, not a real session
  // swap. While it's on, the brand row reads as the active account
  // and the staffer's own row becomes the "switch back" target.
  const asOfficial = isPostingAsOfficial();
  let rows = saved.map(acc => {
    const isSelfRow = acc.id === me.id;
    // When the overlay is on, the staffer's own row is no longer
    // "active" — the official row below is. Click → revert overlay
    // (handled via data-account-revert-official below).
    const active = isSelfRow && !asOfficial;
    const u = { handle: acc.handle, name: acc.name, avatarImage: acc.avatarUrl,
                avatarShape: acc.avatarShape, avatar: (acc.name[0] || '?').toUpperCase() };
    let dataAttr;
    if (active) {
      // Active row: navigate to that profile so the avatar stays a
      // useful entry point.
      dataAttr = 'data-account-profile="' + escapeText(acc.handle) + '"';
    } else if (isSelfRow && asOfficial) {
      // Self row while overlay is on → click reverts the overlay.
      dataAttr = 'data-account-revert-official="1"';
    } else {
      dataAttr = 'data-account-switch-to="' + acc.id + '"';
    }
    const displayName   = maskName(acc.handle, acc.name);
    const displayHandle = maskHandle(acc.handle);
    return (
      '<button type="button" class="account-menu__row' + (active ? ' is-active' : '') + '" ' +
        dataAttr + '>' +
        renderAvatar(u, { size: 'sm' }) +
        '<span class="account-menu__row-text">' +
          '<span class="account-menu__row-name">' + escapeText(displayName) +
            (active ? ' <span class="account-menu__row-badge">' + escapeText(t('settings.accounts.current')) + '</span>' : '') +
          '</span>' +
          '<span class="account-menu__row-handle">@' + escapeText(displayHandle) + '</span>' +
        '</span>' +
      '</button>'
    );
  }).join('');

  // Admin / operator surface: the brand account (@spotcode_official)
  // is the "shared identity" everyone with privilege can act under.
  // No password prompt, no real session swap — the overlay flag
  // tells addPost() to substitute author_id, and Stage 25 RLS
  // validates that the substitution is allowed.
  const showOfficial = isAdmin() || isOperator();
  const official = showOfficial ? cachedOfficialAccount() : null;
  if (official) {
    const ou = {
      handle: official.handle, name: official.name,
      avatarImage: official.avatar_url, avatarShape: official.avatar_shape,
      avatar: (official.name[0] || '?').toUpperCase(),
    };
    const isActiveOverlay = asOfficial;
    const officialDisplayName   = maskName(official.handle, official.name);
    const officialDisplayHandle = maskHandle(official.handle);
    rows +=
      '<button type="button" class="account-menu__row account-menu__row--official' +
        (isActiveOverlay ? ' is-active' : '') + '" ' +
        'data-account-as-official="1">' +
        renderAvatar(ou, { size: 'sm' }) +
        '<span class="account-menu__row-text">' +
          '<span class="account-menu__row-name">' + escapeText(officialDisplayName) +
            ' <span class="account-menu__row-badge account-menu__row-badge--official">' + escapeText(t('account_menu.official')) + '</span>' +
            (isActiveOverlay ? ' <span class="account-menu__row-badge">' + escapeText(t('settings.accounts.current')) + '</span>' : '') +
          '</span>' +
          '<span class="account-menu__row-handle">@' + escapeText(officialDisplayHandle) + '</span>' +
        '</span>' +
      '</button>';
  } else if (showOfficial) {
    // Cache miss + admin/op viewer → kick off the lookup in the
    // background so the row appears on the next open of the menu.
    getOfficialAccount().catch(() => {});
  }
  root.innerHTML =
    '<div class="account-menu__card" role="document">' +
      '<header class="account-menu__head">' +
        '<span class="account-menu__title">' + escapeText(t('account_menu.title')) + '</span>' +
        '<button type="button" class="account-menu__close" data-account-menu-close aria-label="Close">' +
          icon('close', { size: 18 }) +
        '</button>' +
      '</header>' +
      '<div class="account-menu__list">' + rows + '</div>' +
      '<div class="account-menu__sep"></div>' +
      '<button type="button" class="account-menu__row account-menu__row--bad" data-account-menu-logout>' +
        icon('arrow_right', { size: 14, className: 'icon--inline' }) +
        escapeText(t('nav.logout')) +
      '</button>' +
    '</div>';
  // Pin the card under the anchor (topbar avatar or sidebar
  // me-card) on desktop. On narrow viewports we fall back to the
  // centred-modal layout so the card never gets cut off by the
  // screen edge.
  const card = root.querySelector('.account-menu__card');
  if (card && anchorRect && window.innerWidth >= 480) {
    const W = 300;
    let left = Math.min(window.innerWidth - W - 8, Math.max(8, anchorRect.right - W));
    let top  = Math.min(window.innerHeight - 8, anchorRect.bottom + 6);
    card.style.position = 'fixed';
    card.style.left = left + 'px';
    card.style.top  = top + 'px';
    card.style.maxWidth = W + 'px';
    root.classList.add('is-anchored');
  } else if (card) {
    card.style.position = '';
    card.style.left = '';
    card.style.top  = '';
    card.style.maxWidth = '';
    root.classList.remove('is-anchored');
  }
  root.classList.add('is-open');
  document.documentElement.classList.add('account-menu-locked');

  root.onclick = async (e) => {
    // Backdrop click (target === root) is caught by the listener
    // in ensureAccountMenu — here we only handle clicks inside
    // the card.
    if (e.target.closest('[data-account-menu-close]')) {
      closeAccountMenu();
      return;
    }
    // Click on the currently-active row → jump to that profile.
    const profileBtn = e.target.closest('[data-account-profile]');
    if (profileBtn) {
      const handle = profileBtn.getAttribute('data-account-profile');
      closeAccountMenu();
      navigate('/' + handle);
      return;
    }
    const switchBtn = e.target.closest('[data-account-switch-to]');
    if (switchBtn) {
      const id = switchBtn.getAttribute('data-account-switch-to');
      closeAccountMenu();
      try { await switchAccount(id); }
      catch (ex) { alert(ex.message || String(ex)); }
      return;
    }
    // Brand-account row: flip the "posting as official" overlay on.
    // No auth modal, no session swap — the staffer's privilege is
    // the authorization. Stage 25 RLS rechecks the substitution on
    // each insert/update/delete server-side.
    if (e.target.closest('[data-account-as-official]')) {
      closeAccountMenu();
      if (!isAdmin() && !isOperator()) return;
      setPostingAsOfficial(true);
      return;
    }
    // Own row while the overlay is on → drop back to your own
    // identity for posting.
    if (e.target.closest('[data-account-revert-official]')) {
      closeAccountMenu();
      setPostingAsOfficial(false);
      return;
    }
    if (e.target.closest('[data-account-menu-logout]')) {
      closeAccountMenu();
      if (!confirm(t('settings.accounts.confirm_logout') || 'ログアウトしますか？')) return;
      logout().finally(() => navigate('/'));
      return;
    }
    // Re-attach the root-as-backdrop close behaviour (innerHTML
    // doesn't replace listeners on root itself, just descendants).
    if (e.target.classList && e.target.classList.contains('account-menu-overlay')) {
      closeAccountMenu();
    }
  };
}
function escapeText(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// Open on plain click — mobile has no contextmenu, and a left-click
// trigger matches Twitter/X's avatar dropdown UX. Bound via capture
// so we run before the router's link-interception handler swallows
// it as a navigation. We still keep the contextmenu binding as a
// secondary trigger so muscle memory works.
function triggerAccountMenu(e) {
  const anchor = e.target.closest('[data-account-menu]');
  if (!anchor) return;
  e.preventDefault();
  e.stopPropagation();
  openAccountMenu(anchor.getBoundingClientRect());
}
document.addEventListener('click',      triggerAccountMenu, true);
document.addEventListener('contextmenu', triggerAccountMenu, true);

// Spot picked in the composer for the current home view, kept in memory
// so the timeline can re-render without losing the chosen pin.
let pendingSpot = null;
// Photo data URLs queued for the next post submit. Capped at PHOTO_CAP
// to keep the row size bounded — each entry is already resized to
// ~1080px JPEG by fileToPhotoDataUrl, so a 4-photo post lands around
// 500-700 KB worst case.
const PHOTO_CAP = 4;
let pendingPhotos = [];
// Poll attached to the next submit. Same lifecycle as pendingSpot /
// pendingPhotos — lives in memory while composing, included on
// addPost, cleared on submit / discard.
let pendingPoll = null;
// `idea` tag toggle. Mirrors the .compose-kind-toggle button state and
// rides on addPost / updatePost.
let pendingKind = null; // null | 'idea'
// One of: 'public' | 'mutuals' | 'following' | 'friends' | 'org'.
// The actual gating happens server-side via Stage 18 RLS — this
// value just rides on the addPost payload.
let pendingVisibility = 'public';
// Map each audience to one of the SVG icons from icons.js so the
// composer pill and the post-card hint badge share visuals (and so
// the design stays icon-consistent with the rest of the app instead
// of using OS-rendered Unicode emoji).
const VIS_ICONS = {
  public:    'globe',
  mutuals:   'fork',
  following: 'arrow_right',
  friends:   'heart',
  org:       'building',
  restricted:'lock',
};

function dispatch(path) {
  // If a modal closed without unlocking (uncaught error path, navigation
  // mid-animation, …) the body would still be position:fixed and the
  // next page would render shifted. Force-clear once on every nav.
  forceUnlockBodyScroll();
  const reposMatch     = path === '/repos' || path === '/repos/';
  const mapMatch       = path === '/spots' || path === '/spots/';
  const mapCityMatch   = path.match(/^\/spots\/(.+?)\/?$/);
  const spotMatch      = path.match(/^\/spot\/(.+?)\/?$/);
  const analyticsMatch = path.match(/^\/post\/([0-9a-fA-F-]{36})\/analytics\/?$/);
  const postMatch      = path.match(/^\/post\/([0-9a-fA-F-]{36})\/?$/);
  const followMatch    = path.match(/^\/([A-Za-z0-9_][A-Za-z0-9_-]*)\/(following|followers)\/?$/);
  const eventMatch     = path.match(/^\/event\/(\d+)\/?$/);
  const userMatch      = path.match(/^\/([A-Za-z0-9_][A-Za-z0-9_-]*)\/?$/);

  if (path === '/' || path === '') {
    document.title = 'spotcode-sns';
    app.innerHTML = renderHome('foryou');
    restoreComposerDraft();
    if (pendingSpot) syncSpotChip(pendingSpot);
    hydrateHome('foryou');
  } else if (path === '/following') {
    // Same Home view, Following tab active — must come BEFORE userMatch
    // which would otherwise swallow "following" as a handle.
    document.title = 'Following / spotcode-sns';
    app.innerHTML = renderHome('following');
    restoreComposerDraft();
    if (pendingSpot) syncSpotChip(pendingSpot);
    hydrateHome('following');
  } else if (path === '/settings' || /^\/settings\/[a-z]+$/.test(path)) {
    document.title = 'Settings / spotcode-sns';
    app.innerHTML = renderSettings();
    bindSettings();
  } else if (spotMatch) {
    // Accept either the JP city name (/spot/世田谷区) or a romaji slug
    // (/spot/setagaya). The view always queries Supabase with the JP
    // form, since that's what addressDetails.city actually stores.
    const raw = decodeURIComponent(spotMatch[1]);
    const city = romajiToJp(raw) || raw;
    document.title = city + ' / spotcode-sns';
    app.innerHTML = renderSpot(city);
    hydrateSpot(city);
  } else if (followMatch) {
    const handle = followMatch[1];
    const kind   = followMatch[2]; // 'following' | 'followers'
    document.title = '@' + handle + ' ' + kind + ' / spotcode-sns';
    app.innerHTML = renderFollowList(handle, kind);
    hydrateFollowList(handle, kind);
  } else if (mapCityMatch) {
    // City-scoped map view — reached from the right-rail "Trending spots"
    // card. Same canvas as /spots, but filtered and fit-bounded to a
    // single 市区町村 so the user lands looking at that area.
    const raw = decodeURIComponent(mapCityMatch[1]);
    const city = romajiToJp(raw) || raw;
    document.title = city + ' / spotcode-sns';
    app.innerHTML = renderMap(city);
    hydrateMap(city);
  } else if (mapMatch) {
    document.title = 'Map / spotcode-sns';
    app.innerHTML = renderMap();
    hydrateMap();
  } else if (analyticsMatch) {
    const pid = analyticsMatch[1];
    document.title = 'Analytics / spotcode-sns';
    app.innerHTML = renderPostAnalytics(pid);
    hydratePostAnalytics(pid);
  } else if (postMatch) {
    const pid = postMatch[1];
    document.title = 'Post / spotcode-sns';
    app.innerHTML = renderPostDetail(pid);
    hydratePostDetail(pid);
  } else if (path === '/notifications' || path === '/notifications/' ||
             path === '/requests'      || path === '/requests/') {
    // /requests is an alias for /notifications — the inbox shows
    // follow_request rows with inline Accept / Deny. The old route
    // stays valid so existing bookmarks don't 404.
    document.title = 'Notifications / spotcode-sns';
    app.innerHTML = renderNotifications();
    hydrateNotifications();
  } else if (reposMatch) {
    document.title = 'Repos / spotcode-sns';
    app.innerHTML = renderRepos();
    hydrateRepos();
  } else if (eventMatch) {
    const eid = eventMatch[1];
    document.title = 'event #' + eid + ' / spotcode-sns';
    // Lazy-load — the /event/<id> code path (fetches connpass API,
    // renders event head) isn't needed on any hot path so it stays
    // out of the initial main.js bundle. First-time visitor pays a
    // ~10ms import cost; every subsequent visit is instant.
    app.innerHTML = '<div class="stub"><p class="stub__sub">読み込み中…</p></div>';
    import('./views/event.js').then(({ renderEvent, hydrateEvent }) => {
      // Guard against a rapid navigation away — dispatch may have
      // fired again for a different route by the time the import
      // resolves.
      if (currentPath() !== '/event/' + eid) return;
      app.innerHTML = renderEvent(eid);
      hydrateEvent(eid);
    }).catch((err) => {
      console.warn('event view load', err);
      app.innerHTML = '<div class="stub"><p class="stub__sub">読み込みに失敗しました</p></div>';
    });
  } else if (userMatch) {
    const handle = userMatch[1];
    document.title = '@' + handle + ' / spotcode-sns';
    app.innerHTML = renderProfile(handle);
    // Fetch from Supabase if we don't have the user locally, then
    // pull the GitHub contribution graph once we know the
    // github_handle on the profile.
    hydrateProfile(handle).then(() => {
      hydrateProfileActivity(handle);
      hydrateProfileLanguages(handle);
      hydrateProfileTasks(handle);
    });
  } else {
    document.title = 'Not found / spotcode-sns';
    app.innerHTML =
      '<div class="stub">' +
        '<h2 class="stub__title">ページが見つかりません</h2>' +
        '<p class="stub__sub">URL が間違っているか、削除されたページです。</p>' +
      '</div>' +
      quickNavLinks();
  }
  repaintRail();
  refreshRailData();
  setActiveNav(path);
}

function syncSpotChip(spot) {
  const btn = document.getElementById('compose-spot-btn');
  if (!btn) return;
  const textEl = btn.querySelector('[data-spot-text]');
  if (!spot) {
    if (textEl) textEl.textContent = '場所を追加';
    btn.classList.remove('spot-chip--set');
    btn.classList.add('spot-chip--add');
    delete btn.dataset.spotLat;
    delete btn.dataset.spotLng;
    delete btn.dataset.spotLabel;
    const clear = document.getElementById('compose-spot-clear');
    if (clear) clear.hidden = true;
    autosaveComposerDraft();
    return;
  }
  const label = spot.label || (spot.lat.toFixed(4) + ', ' + spot.lng.toFixed(4));
  if (textEl) textEl.textContent = label;
  btn.dataset.spotLat   = String(spot.lat);
  btn.dataset.spotLng   = String(spot.lng);
  btn.dataset.spotLabel = spot.label || '';
  btn.classList.add('spot-chip--set');
  btn.classList.remove('spot-chip--add');
  const clear = document.getElementById('compose-spot-clear');
  if (clear) clear.hidden = false;
  autosaveComposerDraft();
}

// ----- repost menu / share / quote (Stage 11) -----

function closeRepostMenu() {
  document.querySelectorAll('.repost-menu').forEach(m => m.remove());
}

function openRepostMenu(forkBtn) {
  const postId = forkBtn.getAttribute('data-post-id') ||
                 forkBtn.closest('[data-post-id]')?.getAttribute('data-post-id');
  if (!postId) return;
  const reposted = forkBtn.classList.contains('is-on');
  const menu = document.createElement('div');
  menu.className = 'repost-menu';
  menu.innerHTML =
    '<button type="button" class="repost-menu__item" data-repost-action="repost" data-post-id="' + postId + '">' +
      (reposted ? 'リポストを取り消す' : 'リポスト') +
    '</button>' +
    '<button type="button" class="repost-menu__item" data-repost-action="quote" data-post-id="' + postId + '">' +
      '引用' +
    '</button>';
  // Anchor the menu below the fork button — uses viewport coordinates
  // so it stays in place during scroll within a single open session.
  const r = forkBtn.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top  = (r.bottom + 4) + 'px';
  menu.style.left = Math.max(8, Math.min(window.innerWidth - 180, r.left)) + 'px';
  document.body.appendChild(menu);
}

// Web Share API where available (mobile Safari, Chrome Android), with
// clipboard fallback so desktop browsers without share UI still get a
// usable action. Falls back further to alert() if both fail.
async function sharePost(postId, btn) {
  const link = location.origin + (window.__BASE__ || '/') + 'post/' + postId;
  const data = { title: 'spotcode-sns', url: link };
  try {
    if (navigator.share) { await navigator.share(data); return; }
  } catch { /* user cancelled — silent */ return; }
  try {
    await navigator.clipboard.writeText(link);
    flashShareToast(btn, 'リンクをコピーしました');
    return;
  } catch {
    alert('リンク: ' + link);
  }
}

function flashShareToast(anchor, msg) {
  const t = document.createElement('div');
  t.className = 'share-toast';
  t.textContent = msg;
  const r = anchor.getBoundingClientRect();
  t.style.position = 'fixed';
  t.style.top  = (r.top - 36) + 'px';
  t.style.left = r.left + 'px';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1600);
}

// Quote composer modal. Opens a textarea with the quoted post embedded
// below. On submit, posts via addQuote(post, quotedPostId).
import('./views/quote-modal.js').catch(() => {});
async function openQuoteComposer(postId) {
  const mod = await import('./views/quote-modal.js');
  mod.openQuoteModal(postId);
}

// ----- composer drafts -----
// Scope drafts per signed-in handle (logged-out users share `_guest`).
function draftHandle() {
  const me = currentUser();
  return me ? me.handle : '_guest';
}

function readComposerState() {
  const form = document.querySelector('.idea-form');
  if (!form) return null;
  const ta   = form.querySelector('textarea[name="text"]');
  const gh   = form.querySelector('input[name="github"]');
  const ev   = form.querySelector('input[name="event"]');
  return {
    body:       ta ? ta.value : '',
    githubLink: gh ? gh.value : '',
    eventUrl:   ev ? ev.value : '',
    spot:       pendingSpot,
    kind:       pendingKind,
    visibility: pendingVisibility,
  };
}

// Wipe the composer UI back to its blank state (textarea + GitHub link +
// spot chip). Used after a successful submit and after "Discard draft".
function clearComposerUI() {
  const form = document.querySelector('.idea-form');
  if (!form) return;
  const ta = form.querySelector('textarea[name="text"]');
  if (ta) {
    ta.value = '';
    ta.style.height = 'auto';
  }
  const gh = form.querySelector('input[name="github"]');
  if (gh) gh.value = '';
  const ev = form.querySelector('input[name="event"]');
  if (ev) ev.value = '';
  const row = document.getElementById('compose-link-row');
  if (row) row.hidden = true;
  const eventRow = document.getElementById('compose-event-row');
  if (eventRow) eventRow.hidden = true;
  const linkToggle = document.getElementById('compose-link-toggle');
  if (linkToggle) linkToggle.setAttribute('aria-expanded', 'false');
  const eventToggle = document.getElementById('compose-event-toggle');
  if (eventToggle) eventToggle.setAttribute('aria-expanded', 'false');
  pendingSpot = null;
  syncSpotChip(null);
  pendingPhotos = [];
  renderPhotoPreviews();
  pendingPoll = null;
  renderPollChip();
  pendingKind = null;
  syncKindToggle();
  pendingVisibility = 'public';
  syncVisToggle();
  hideDraftBanner();
}

// Reflect pendingKind on the toggle button (pressed style + data attr).
// Safe to call when the button isn't in the DOM — e.g. logged-out
// composer-gate has no toggle to update.
function syncKindToggle() {
  const btn = document.getElementById('compose-kind-toggle');
  if (!btn) return;
  const on = pendingKind === 'idea';
  btn.setAttribute('aria-pressed', String(on));
  btn.dataset.kind = on ? 'idea' : 'off';
}

// Push the pendingVisibility back onto the <select> so a draft restore
// or a clear-after-submit reflects the right option. Also re-mirrors
// the option text onto the visible display span.
function syncVisToggle() {
  const sel = document.getElementById('compose-vis-select');
  if (!sel) return;
  sel.value = pendingVisibility;
  const display = document.querySelector('[data-vis-current]');
  const iconEl  = document.querySelector('[data-vis-icon]');
  const picked  = sel.options[sel.selectedIndex];
  if (display && picked) display.textContent = picked.textContent;
  if (iconEl) iconEl.innerHTML = icon(VIS_ICONS[pendingVisibility] || 'globe', { size: 12, className: 'icon--inline' });
}

// Re-render the small pill that announces an attached poll in the
// composer, mirroring the spot-chip pattern. Click → re-open the
// poll modal to edit.
function renderPollChip() {
  let chip = document.getElementById('compose-poll-chip');
  if (!pendingPoll) { if (chip) chip.remove(); return; }
  const labelOpts = pendingPoll.options.slice(0, 2).join(' / ') +
    (pendingPoll.options.length > 2 ? ` …+${pendingPoll.options.length - 2}` : '');
  const html =
    '<button type="button" class="spot-chip spot-chip--set" id="compose-poll-chip" title="クリックして編集">' +
      icon('chart', { size: 12, className: 'icon--inline' }) + '投票: ' + labelOpts +
    '</button>';
  if (chip) chip.outerHTML = html;
  else {
    const meta = document.querySelector('.compose-meta');
    if (meta) meta.insertAdjacentHTML('beforeend', html);
  }
}

// Re-render the thumbnail row from pendingPhotos. Hidden when empty
// so it doesn't reserve vertical space in the composer.
function renderPhotoPreviews() {
  const row = document.getElementById('compose-photos');
  if (!row) return;
  if (!pendingPhotos.length) {
    row.hidden = true;
    row.innerHTML = '';
    return;
  }
  row.hidden = false;
  row.innerHTML = pendingPhotos.map((src, i) => (
    '<div class="compose-photo">' +
      '<img src="' + src + '" alt="">' +
      '<button type="button" class="compose-photo__remove" data-idx="' + i + '" aria-label="削除">×</button>' +
    '</div>'
  )).join('');
}

// File-input change → resize each picked file in parallel and append
// to pendingPhotos (capped). Sourced from the composer-injected
// hidden <input type="file">; we wire it once at document level so
// it survives the composer being re-rendered by the router.
document.addEventListener('change', async (e) => {
  // Audience picker — store the selection so the next addPost knows
  // who the post is for. Allowed values match the Stage 18 CHECK.
  // Also mirror the picked option's display text + matching SVG icon
  // onto the visible spans (the native <select> sits invisibly over).
  if (e.target?.id === 'compose-vis-select') {
    const sel = e.target;
    const v = String(sel.value || 'public');
    const ALLOWED = new Set(['public', 'mutuals', 'following', 'friends', 'org']);
    pendingVisibility = ALLOWED.has(v) ? v : 'public';
    const display = document.querySelector('[data-vis-current]');
    const iconEl  = document.querySelector('[data-vis-icon]');
    const picked  = sel.options[sel.selectedIndex];
    if (display && picked) display.textContent = picked.textContent;
    if (iconEl) iconEl.innerHTML = icon(VIS_ICONS[pendingVisibility] || 'globe', { size: 12, className: 'icon--inline' });
    autosaveComposerDraft();
    return;
  }
  if (e.target?.id !== 'compose-photo-input') return;
  const files = Array.from(e.target.files || []);
  e.target.value = ''; // allow re-picking the same file later
  if (!files.length) return;
  const room = Math.max(0, PHOTO_CAP - pendingPhotos.length);
  if (!room) { alert('写真は最大 ' + PHOTO_CAP + ' 枚までです'); return; }
  const toProcess = files.slice(0, room);
  try {
    const urls = await Promise.all(toProcess.map(f => fileToPhotoDataUrl(f)));
    pendingPhotos.push(...urls);
    renderPhotoPreviews();
    autosaveComposerDraft();
  } catch (err) {
    const reason =
      err.message === 'NOT_IMAGE' ? '画像ファイルだけ選んでください'
      : err.message === 'TOO_LARGE' ? '画像が大きすぎます（20MB まで）'
      : err.message === 'IMAGE_DECODE' ? '画像を読み込めませんでした'
      : err.message;
    alert('写真の処理に失敗: ' + reason);
  }
});

function showDraftBanner(message) {
  const b = document.getElementById('compose-draft-banner');
  if (!b) return;
  const text = b.querySelector('[data-draft-text]');
  if (text && message) text.textContent = message;
  b.hidden = false;
}

function hideDraftBanner() {
  const b = document.getElementById('compose-draft-banner');
  if (b) b.hidden = true;
}

// Pull whatever is in the textarea / link / spot chip and persist it.
// Debounced so input events don't hammer localStorage.
const autosaveComposerDraft = debounce(() => {
  const state = readComposerState();
  if (!state) return;
  saveDraft(draftHandle(), state);
}, 400);

// Synchronous flush — no debounce, no async. Called from pagehide /
// visibilitychange where the browser may freeze or unload the tab
// within microseconds and a pending 400ms setTimeout would never fire.
// Without this, typing a draft and immediately switching to another
// site / tab / app loses the last <400ms of typing.
function flushComposerDraft() {
  autosaveComposerDraft.flush?.();
  const state = readComposerState();
  if (state) saveDraft(draftHandle(), state);
}
// `pagehide` is the reliable mobile-Safari signal that the tab is
// about to go away (back/forward cache, app switch, tab close).
// `visibilitychange → hidden` covers the in-app case (user pulls down
// notification centre, opens a link in a new tab, …) where pagehide
// doesn't fire.
window.addEventListener('pagehide', flushComposerDraft);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushComposerDraft();
});

// Called from dispatch() right after rendering home. Fills the textarea,
// pops open the link row if a draft URL exists, re-attaches the saved
// spot via syncSpotChip, and shows the "Draft restored" banner.
function restoreComposerDraft() {
  const handle = draftHandle();
  const d = loadDraft(handle);
  if (!d) return;
  const form = document.querySelector('.idea-form');
  if (!form) return;
  const ta = form.querySelector('textarea[name="text"]');
  if (ta && d.body) {
    ta.value = d.body;
    // Trigger the auto-grow so the textarea isn't 2-rows tall on a long draft.
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 320) + 'px';
  }
  if (d.githubLink) {
    const gh = form.querySelector('input[name="github"]');
    if (gh) gh.value = d.githubLink;
    const row = document.getElementById('compose-link-row');
    if (row) row.hidden = false;
    const linkToggle = document.getElementById('compose-link-toggle');
    if (linkToggle) linkToggle.setAttribute('aria-expanded', 'true');
  }
  if (d.eventUrl) {
    const ev = form.querySelector('input[name="event"]');
    if (ev) ev.value = d.eventUrl;
    const evRow = document.getElementById('compose-event-row');
    if (evRow) evRow.hidden = false;
    const evToggle = document.getElementById('compose-event-toggle');
    if (evToggle) evToggle.setAttribute('aria-expanded', 'true');
  }
  if (d.spot && d.spot.lat != null && d.spot.lng != null) {
    pendingSpot = d.spot;
    syncSpotChip(d.spot);
  }
  if (d.kind === 'idea') {
    pendingKind = 'idea';
    syncKindToggle();
  }
  if (typeof d.visibility === 'string' && d.visibility !== 'public') {
    const ALLOWED = new Set(['mutuals', 'following', 'friends', 'org', 'restricted']);
    if (ALLOWED.has(d.visibility)) {
      pendingVisibility = d.visibility;
      syncVisToggle();
    }
  }
  showDraftBanner();
}

initThemeToggle(document.getElementById('theme-toggle'));

// Restore the Supabase session (if any) before the first render so the
// app doesn't flash a logged-out state to a returning user. Failures here
// (Supabase down, no network) leave cachedUser null — the app still works
// as a logged-out static site.
try { await initAuth(); } catch (err) { console.warn('initAuth failed', err); }
// Post-redirect GitHub OAuth sync. If the user JUST returned from
// linkGithub()'s redirect, the auth user carries a fresh `github`
// identity that isn't mirrored into public.profiles yet — writing
// it here lets the very first render show the verified badge + link
// icon without needing another reload. Idempotent: a no-op when no
// identity is linked or the profile row already matches.
//
// Same boot hook also promotes the GitHub API calls (language-stats
// / repos / tasks) from anonymous 60 req/h to authenticated 5000
// req/h when the user has linked, by wiring the Supabase-captured
// `provider_token` into fetchJson via setGithubApiToken.
if (currentUser()) {
  import('./github-oauth.js').then(({ syncGithubIdentity, getGithubToken }) => {
    syncGithubIdentity().catch((err) => console.warn('syncGithubIdentity', err));
    getGithubToken()
      .then((token) => {
        if (!token) return;
        return import('./language-stats.js').then(({ setGithubApiToken }) => setGithubApiToken(token));
      })
      .catch(() => {});
  });
}
// Warm the official-account cache for admins / operators so the
// brand-account row shows up the first time they open the account
// menu instead of on the second open. Regular users skip the call —
// they have no use for the row.
if (isAdmin() || isOperator()) {
  getOfficialAccount().then(async (acct) => {
    if (acct && isPostingAsOfficial()) {
      // Overlay was persisted ON from a previous session: at first
      // paint `cachedOfficialAccount()` was still null, so
      // displayUser() fell back to the real user — the topbar /
      // side-nav / profile cards rendered the WRONG identity. Now
      // that the official row is cached, await
      // `hydrateOfficialFollows` first, then re-render the chrome +
      // re-dispatch ONCE so the active view paints with the brand
      // identity AND the correct "Following" badges in a single
      // pass. The previous version did `refresh()` synchronously and
      // again via `hydrateOfficialFollows().then(refresh)` — two
      // full dispatches per page load, which doubled every render's
      // network cost on admin/operator accounts.
      try { await hydrateOfficialFollows(acct.id); } catch {}
      renderAuthArea();
      renderSideMe();
      refresh();
    }
  }).catch(() => {});
}
// Once logged in, pre-load the set of handles I follow so isFollowing()
// can answer synchronously from the render path.
hydrateMyFollows();
// Apply the dev-mode html[data-dev] flag so dev-only CSS can scope its
// chrome (e.g. the dev-mode topbar indicator) without flashing.
initDevMode();
// Apply user display prefs (currently: hide-badges toggle) so the
// CSS gating is in place before the first paint.
applyDisplayPrefs();
initI18n();
// One-shot schema probe so the first real query already knows which
// optional columns are missing, instead of discovering them one
// retry at a time per visible page.
probeSchema();
// Warm the geo-gate cache as early as possible. Without this, the
// home / profile / spot timelines render with an empty location fix
// → every spot-tagged post shows as locked until the viewer navigates
// to the map. Fire-and-forget: if the browser-cached permission still
// lets us through, this resolves in ~100ms with no UI prompt; if
// permission was previously denied it resolves to null immediately.
// On a successful fix we refresh() the current route so the in-flight
// timeline re-renders with the now-warm geo state.
import('./geo-gate.js').then(({ getMyLocation }) => {
  getMyLocation().then((fix) => { if (fix) refresh(); }).catch(() => {});
});
initIosZoomGuard();

// Mobile hamburger drawer — opens / closes the off-canvas sidenav.
// No-op on desktop where the drawer never shows.
(function initDrawer() {
  const toggle   = document.getElementById('drawer-toggle');
  const backdrop = document.getElementById('drawer-backdrop');
  if (!toggle || !backdrop) return;
  let open = false;
  function setOpen(next) {
    if (next === open) return;
    open = next;
    document.body.classList.toggle('drawer-open', open);
    backdrop.hidden = !open;
    if (open) lockBodyScroll(); else unlockBodyScroll();
  }
  toggle.addEventListener('click', () => setOpen(!open));
  backdrop.addEventListener('click', () => setOpen(false));
  // Any sidenav tap closes the drawer so the user lands on the new page
  // without the drawer sitting open over it.
  document.querySelectorAll('.side-nav__item, .compose-cta, .me-card').forEach(el => {
    el.addEventListener('click', () => setTimeout(() => setOpen(false), 30));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) setOpen(false);
  });
})();
// Patch the static topbar placeholder so it picks up the active language.
const searchInput = document.querySelector('.topbar__search input');
if (searchInput) searchInput.placeholder = t('nav.search.placeholder');

onRoute(dispatch);
renderAuthArea();
renderSideMe();
initSearch();
initMentionAutocomplete();

// Browser Notifications API plumbing — fires OS-level banners for
// likes / comments / mentions / follows / follow_requests (via the
// notif poller diffing notificationsForMe), and for nearby spots
// (geolocation + distance compute against cached spot posts).
// Both pollers self-gate on `canPush()` so leaving them booted is
// cheap when the user hasn't opted in; the import is intentional so
// they can flip on / off via the /settings toggle without a reload.
import('./push-notify.js').then(({ isPushEnabled, onPushPrefChange }) => {
  let started = false;
  function syncBoot() {
    const want = isPushEnabled() && !!currentUser();
    if (want && !started) {
      started = true;
      Promise.all([
        import('./notif-poller.js'),
        import('./nearby-spot-watcher.js'),
      ]).then(([{ startNotifPoller }, { startNearbySpotWatcher }]) => {
        startNotifPoller();
        startNearbySpotWatcher();
      });
    } else if (!want && started) {
      started = false;
      Promise.all([
        import('./notif-poller.js'),
        import('./nearby-spot-watcher.js'),
      ]).then(([{ stopNotifPoller }, { stopNearbySpotWatcher }]) => {
        stopNotifPoller();
        stopNearbySpotWatcher();
      });
    }
  }
  syncBoot();
  onPushPrefChange(syncBoot);
  onAuthChange(() => {
    // Identity change → reset the dedupe watermark so the new user's
    // existing inbox doesn't fire as backlog, then re-evaluate boot.
    import('./notif-poller.js').then(({ resetNotifPollerSeed }) => resetNotifPollerSeed());
    syncBoot();
  });
});

// Privacy-mode flip: every visible surface needs to re-render so
// names/handles swap in (or out). refresh() re-dispatches the
// current route, which re-renders the timeline / profile / inbox /
// rail — the masking helpers themselves self-gate on isOperator(),
// so no extra side-effects when the toggle is a no-op for the
// current viewer.
onPrivacyModeChange(() => { refresh(); });

onAuthChange(() => {
  // The signed-in identity changed (login / logout / profile update) —
  // drop the like/follow cache so the next renders re-fetch with the
  // right `auth.uid()` context, then warm the new user's follows.
  clearInteractionsCache();
  hydrateMyFollows();
  // New identity → the Who-to-follow exclusions changed; let the next
  // dispatch refetch rail data instead of serving the old user's.
  railFetchedAt = 0;
  // If the new identity isn't admin / operator, drop the
  // "posting as official" overlay so a regular user can't inherit it
  // by signing in on the same device.
  if (!isAdmin() && !isOperator() && isPostingAsOfficial()) {
    setPostingAsOfficial(false);
  }
  renderAuthArea();
  renderSideMe();
  refresh();
});

// The "posting as official" overlay flips on / off → re-paint the
// chrome (avatars, composer) so the new identity is visible
// immediately without a page reload. When flipping ON, also warm
// the official's follows cache so the next renderProfile reads
// the brand's graph (otherwise "Following" badges would echo the
// auth user's followsMine, showing wrong state for the brand).
onPostingIdentityChange((on) => {
  if (on) {
    const acct = cachedOfficialAccount();
    if (acct) hydrateOfficialFollows(acct.id).then(refresh).catch(() => {});
    else      getOfficialAccount().then((a) => {
                if (a) return hydrateOfficialFollows(a.id);
              }).then(refresh).catch(() => {});
  }
  renderAuthArea();
  renderSideMe();
  refresh();
});

// ----- delegated UI events -----

// (Removed the global focusin → scrollIntoView handler that fired on
// every textarea tap: it caused a small smooth-scroll the user didn't
// ask for. The "New idea" CTA below still scrolls the composer into
// view explicitly — that's the one place auto-scroll is intended.)

document.getElementById('open-compose')?.addEventListener('click', () => {
  if (!currentUser()) return openAuth('register');
  navigate('/');
  setTimeout(() => {
    const ta = document.querySelector('.composer textarea');
    if (!ta) return;
    // Only scroll when the textarea is actually offscreen — `New idea`
    // tapped from a scrolled-down position should jump up, but tapping
    // it while the composer is already visible shouldn't budge.
    const r = ta.getBoundingClientRect();
    const offscreen = r.top < 0 || r.top > window.innerHeight - 80;
    if (offscreen) ta.scrollIntoView({ block: 'start', behavior: 'smooth' });
    ta.focus();
  }, 30);
});

// Delegated handler for "Post about this repo" buttons on /repos
// cards. Same shape as #open-compose, but additionally pre-fills the
// composer's GitHub link input + unhides the link row so the URL is
// already attached when the user starts typing. The `setTimeout` is
// what lets `dispatch('/')` finish (it replaces #app synchronously,
// so the composer textarea exists on the next tick).
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-compose-repo]');
  if (!btn) return;
  e.preventDefault();
  if (!currentUser()) return openAuth('register');
  const url = btn.getAttribute('data-compose-repo') || '';
  navigate('/');
  setTimeout(() => {
    const form = document.querySelector('.idea-form');
    if (!form) return;
    const gh = form.querySelector('input[name="github"]');
    if (gh) gh.value = url;
    const row = document.getElementById('compose-link-row');
    if (row) row.hidden = false;
    const toggle = document.getElementById('compose-link-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
    const ta = form.querySelector('textarea[name="text"]');
    if (!ta) return;
    const r = ta.getBoundingClientRect();
    const offscreen = r.top < 0 || r.top > window.innerHeight - 80;
    if (offscreen) ta.scrollIntoView({ block: 'start', behavior: 'smooth' });
    ta.focus();
  }, 30);
});

document.addEventListener('click', (e) => {
  const auth = e.target.closest('[data-auth]');
  if (auth) {
    e.preventDefault();
    openAuth(auth.dataset.auth === 'register' ? 'register' : 'login');
    return;
  }

  // Profile-page tabs (Posts / Spots / Likes). They keep the URL on
  // /<handle> and only swap the body — no navigation, no scroll jump.
  const profileTab = e.target.closest('[data-profile-tab]');
  if (profileTab) {
    e.preventDefault();
    setProfileTab(
      profileTab.getAttribute('data-profile-handle'),
      profileTab.getAttribute('data-profile-tab'),
    );
    return;
  }
  // (Removed #logout-btn click handler — logout now lives in the
  // right-click menu on the sidebar account card. See
  // openAccountMenu above.)

  // Per-comment delete button on the post detail page.
  const cdel = e.target.closest('[data-comment-delete]');
  if (cdel) {
    e.preventDefault();
    handleCommentDelete(cdel.getAttribute('data-comment-delete'));
    return;
  }

  // Inline Accept / Deny on the notifications view's follow-request rows.
  if (handleNotifAction(e)) return;

  // Profile Tasks card: expand-body toggle + repo-chip filter.
  if (handleTasksClick(e)) return;

  // Timeout / error stubs across follow-list and profile show a
  // small "再試行" button that re-runs the current route's hydrate
  // by re-dispatching. refresh() is cheap: the top-level chrome is
  // re-rendered and each view's own hydrate re-runs — same as
  // navigating away and back, but without disturbing scroll or the
  // URL.
  if (e.target.closest('[data-follow-list-retry]') ||
      e.target.closest('[data-profile-retry]')) {
    e.preventDefault();
    refresh();
    return;
  }
  if (e.target.closest('#edit-profile-btn')) {
    e.preventDefault();
    if (!currentUser()) return openAuth('login');
    openEditProfile();
    return;
  }

  // Profile "More" button — opens the copy-link / report-user popover.
  const moreBtn = e.target.closest('[data-profile-more]');
  if (moreBtn) {
    e.preventDefault();
    openProfileMore(moreBtn.getAttribute('data-profile-more'), moreBtn);
    return;
  }

  // Report a post (flag button).
  const reportBtn = e.target.closest('.act--report');
  if (reportBtn) {
    e.preventDefault();
    const me = currentUser();
    if (!me) return openAuth('login');
    const post = reportBtn.closest('[data-post-id]');
    if (!post) return;
    openReport(post.getAttribute('data-post-id'));
    return;
  }

  // Enter edit mode — swap the post body for a textarea + metadata
  // pills + Save/Cancel. Only rendered on own posts, so no extra
  // owner check needed here.
  const editBtn = e.target.closest('.act--edit');
  if (editBtn) {
    e.preventDefault();
    const post = editBtn.closest('[data-post-id]');
    if (!post) return;
    const body = post.querySelector('.post__body');
    if (!body || body.querySelector('textarea')) return; // already editing
    const original = body.textContent;
    // Cache original DOM so Cancel restores formatting (mentions etc.).
    body.dataset.originalHtml = body.innerHTML;
    // Seed the edit-mode metadata fields from what's already visible
    // on the post card so the user can rotate / clear values without
    // re-typing. Idea badge: `.post__kind--idea` on the head.
    // GitHub link: `.post__meta > .post__link` sibling of the body
    // (NOT inside the body — escape() in renderPost puts it after).
    const isIdea = !!post.querySelector('.post__kind--idea');
    const ghLink = post.querySelector('.post__meta .post__link')?.getAttribute('href') || '';
    const escAttr = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
    body.innerHTML =
      '<textarea class="post__edit-input" rows="3">' +
        // textareas treat raw text only — escape isn't needed because
        // the browser handles it, but we do need < / & sanitised.
        String(original).replace(/&/g, '&amp;').replace(/</g, '&lt;') +
      '</textarea>' +
      '<div class="post__edit-meta">' +
        '<button type="button" class="post__edit-pill act--edit-toggle-idea' +
          (isIdea ? ' is-active' : '') + '" aria-pressed="' + (isIdea ? 'true' : 'false') + '">' +
          'アイデア' +
        '</button>' +
        '<label class="post__edit-link">' +
          'GitHub link' +
          '<input type="url" class="post__edit-link-input" placeholder="https://github.com/owner/repo" value="' + escAttr(ghLink) + '">' +
        '</label>' +
      '</div>' +
      '<div class="post__edit-actions">' +
        '<button type="button" class="btn btn--ghost btn--sm act--edit-cancel">キャンセル</button>' +
        '<button type="button" class="btn btn--primary btn--sm act--edit-save">保存</button>' +
      '</div>';
    const ta = body.querySelector('textarea');
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    return;
  }
  // Toggle the idea pill in-place (no save until the Save button).
  const ideaToggleBtn = e.target.closest('.act--edit-toggle-idea');
  if (ideaToggleBtn) {
    e.preventDefault();
    const active = ideaToggleBtn.classList.toggle('is-active');
    ideaToggleBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    return;
  }
  const cancelBtn = e.target.closest('.act--edit-cancel');
  if (cancelBtn) {
    e.preventDefault();
    const body = cancelBtn.closest('.post__body');
    if (!body) return;
    if (body.dataset.originalHtml != null) {
      body.innerHTML = body.dataset.originalHtml;
      delete body.dataset.originalHtml;
    }
    return;
  }
  const saveBtn = e.target.closest('.act--edit-save');
  if (saveBtn) {
    e.preventDefault();
    const post = saveBtn.closest('[data-post-id]');
    const body = saveBtn.closest('.post__body');
    if (!post || !body) return;
    const ta = body.querySelector('textarea');
    if (!ta) return;
    const newBody = ta.value.trim();
    if (!newBody) { alert('本文を入力してください'); return; }
    // Pull the metadata fields from the inline editor. Idea toggle
    // state lives on the pill (.is-active class); the link input is
    // text, trimmed; empty → null so the backing column gets cleared.
    const ideaActive = !!body.querySelector('.act--edit-toggle-idea.is-active');
    const linkInput = body.querySelector('.post__edit-link-input');
    const newLink = linkInput ? linkInput.value.trim() : '';
    saveBtn.disabled = true;
    ta.disabled = true;
    if (linkInput) linkInput.disabled = true;
    updatePost(post.getAttribute('data-post-id'), {
      body:       newBody,
      kind:       ideaActive ? 'idea' : null,
      githubLink: newLink || null,
    })
      .then(() => {
        // Re-render the body inline — keep the post card in place so
        // scroll position / surrounding cards don't jump.
        // inlineFormat lives in post.js; cheaper than a full refresh().
        import('./post.js').then(({ inlineFormat }) => {
          const safe = newBody.replace(/[&<>"']/g, (c) => ({
            '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
          }[c]));
          body.innerHTML = inlineFormat(safe);
          delete body.dataset.originalHtml;
          // Stamp a synthetic "(編集済み)" pill if it isn't there yet.
          const head = post.querySelector('.post__head');
          if (head && !head.querySelector('.post__edited')) {
            head.querySelector('.post__time')?.insertAdjacentHTML('afterend',
              '<span class="post__edited">（編集済み）</span>');
          }
          // Patch the idea badge in the head: add it if newly tagged,
          // remove it if untagged. Cheaper than a full re-render and
          // keeps the rest of the head (spot chip, time, visibility
          // pill) untouched. The badge HTML matches renderPost's
          // template so a follow-up refresh() wouldn't see a delta.
          if (head) {
            const existingIdea = head.querySelector('.post__kind--idea');
            if (ideaActive && !existingIdea) {
              head.querySelector('.post__time')?.insertAdjacentHTML('afterend',
                ' <span class="post__kind post__kind--idea" title="アイデア">' +
                  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon--inline"><path d="M12 2l3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/></svg>' +
                  'アイデア' +
                '</span>');
            } else if (!ideaActive && existingIdea) {
              existingIdea.remove();
            }
          }
          // Patch the github_link chip (sibling of .post__body inside
          // .post__main). Three transitions to handle:
          //   added (no chip → new) — insert .post__meta after body
          //   updated (chip → diff url) — set href + text
          //   cleared (chip → empty) — remove the chip's wrapper
          const safeNewLink = (newLink || '').replace(/[&<>"']/g, (c) => ({
            '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
          }[c]));
          let metaRow = post.querySelector('.post__meta');
          const existingLink = metaRow?.querySelector('.post__link');
          if (newLink) {
            const linkHtml =
              '<a class="post__link" href="' + safeNewLink + '" target="_blank" rel="noopener noreferrer">' +
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" class="icon--inline"><path d="M12 0a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.1c-3.3.7-4-1.6-4-1.6-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.3-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.3a11.5 11.5 0 0 1 6 0c2.3-1.6 3.3-1.3 3.3-1.3.6 1.7.2 2.9.1 3.2.8.9 1.2 2 1.2 3.3 0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 0z"/></svg>' +
                safeNewLink +
              '</a>';
            if (existingLink) {
              existingLink.outerHTML = linkHtml;
            } else if (metaRow) {
              metaRow.insertAdjacentHTML('beforeend', linkHtml);
            } else {
              body.insertAdjacentHTML('afterend',
                '<div class="post__meta">' + linkHtml + '</div>');
            }
          } else if (existingLink) {
            const wrapper = existingLink.parentElement;
            existingLink.remove();
            // Drop the meta row if it's now empty so the layout collapses.
            if (wrapper && !wrapper.children.length) wrapper.remove();
          }
        });
      })
      .catch((err) => {
        alert('編集に失敗しました: ' + err.message);
        saveBtn.disabled = false;
        ta.disabled = false;
        if (linkInput) linkInput.disabled = false;
      });
    return;
  }

  // Delete own post (trash button — only rendered on own posts).
  const deleteBtn = e.target.closest('.act--delete');
  if (deleteBtn) {
    e.preventDefault();
    const post = deleteBtn.closest('[data-post-id]');
    if (!post) return;
    const foreign = deleteBtn.hasAttribute('data-foreign-delete');
    const msg = foreign
      ? '他のユーザーの投稿を削除します。本当によろしいですか？元に戻せません。'
      : 'この投稿を削除しますか？元に戻せません。';
    if (!confirm(msg)) return;
    deleteBtn.disabled = true;
    const id = post.getAttribute('data-post-id');
    // Mark the id as pending-delete BEFORE the round-trip so any
    // navigation / refresh that fires mid-flight (renderHome,
    // renderProfile, etc.) filters this row out instead of painting
    // it from the cached snapshot. cachedPosts + mergeOptimistic
    // both consult `pendingDeletes` for this.
    markPendingDelete(id);
    // Fade-then-hide is what the user perceives as "instant" — drop
    // it from the DOM on success, restore (unmark + un-fade) on error.
    post.style.opacity = '.4';
    post.style.pointerEvents = 'none';
    removePost(id)
      .then(() => {
        // removePost already pruned the persistent caches; just
        // remove the DOM node so the surrounding cards reflow.
        post.remove();
      })
      .catch((err) => {
        unmarkPendingDelete(id);
        alert('削除に失敗しました: ' + err.message);
        post.style.opacity = '';
        post.style.pointerEvents = '';
        deleteBtn.disabled = false;
      });
    return;
  }

  // Like a post (heart button).
  const likeBtn = e.target.closest('.act--like');
  if (likeBtn) {
    e.preventDefault();
    const me = currentUser();
    if (!me) return openAuth('login');
    const post = likeBtn.closest('[data-post-id]');
    if (!post) return;
    const postId = post.getAttribute('data-post-id');
    likeBtn.disabled = true;
    toggleLike(postId)
      .then((now) => {
        likeBtn.classList.toggle('is-liked', now);
        const span = likeBtn.querySelector('span');
        if (span) span.textContent = String(likeCount(postId));
      })
      .catch((err) => alert('いいねに失敗しました: ' + err.message))
      .finally(() => { likeBtn.disabled = false; });
    return;
  }

  // Repost / Quote menu (fork button repurposed). Two-step: tap shows
  // the menu, tap an item runs the action. Reuses the closeRepostMenu
  // helper so an outside-click closes any open menu.
  const forkBtn = e.target.closest('.act--fork');
  if (forkBtn) {
    e.preventDefault();
    const me = currentUser();
    if (!me) return openAuth('login');
    closeRepostMenu();
    openRepostMenu(forkBtn);
    return;
  }
  const repostItem = e.target.closest('[data-repost-action]');
  if (repostItem) {
    e.preventDefault();
    const action = repostItem.getAttribute('data-repost-action');
    const postId = repostItem.getAttribute('data-post-id');
    closeRepostMenu();
    if (action === 'repost') {
      toggleRepost(postId)
        .then((now) => {
          // Re-render the timeline so all visible occurrences flip state.
          refresh();
          if (!now) return;
        })
        .catch((err) => alert(err.message));
    } else if (action === 'quote') {
      openQuoteComposer(postId);
    }
    return;
  }
  // Outside click on an open repost menu closes it.
  if (document.querySelector('.repost-menu') && !e.target.closest('.repost-menu')) {
    closeRepostMenu();
  }

  // Bookmark / save (star button repurposed).
  const starBtn = e.target.closest('.act--star');
  if (starBtn) {
    e.preventDefault();
    const me = currentUser();
    if (!me) return openAuth('login');
    const postId = starBtn.getAttribute('data-post-id') ||
                   starBtn.closest('[data-post-id]')?.getAttribute('data-post-id');
    if (!postId) return;
    starBtn.disabled = true;
    toggleBookmark(postId)
      .then((now) => {
        starBtn.classList.toggle('is-on', now);
        const span = starBtn.querySelector('span');
        if (span) {
          const cur = parseInt(span.textContent, 10) || 0;
          span.textContent = String(Math.max(0, cur + (now ? 1 : -1)));
        }
      })
      .catch((err) => alert(err.message))
      .finally(() => { starBtn.disabled = false; });
    return;
  }

  // Share (Web Share API w/ clipboard fallback).
  const shareBtn = e.target.closest('.act--share');
  if (shareBtn) {
    e.preventDefault();
    const postId = shareBtn.getAttribute('data-post-id') ||
                   shareBtn.closest('[data-post-id]')?.getAttribute('data-post-id');
    if (!postId) return;
    sharePost(postId, shareBtn);
    return;
  }

  // Follow / unfollow (profile + Who-to-follow).
  // While the「公式」overlay is on, the click runs with
  // `actorUserId = official.id` so the row goes into the brand's
  // follow graph (Stage 26 RLS validates the substitution).
  // Otherwise the click executes as the auth user.
  const followBtn = e.target.closest('.btn--follow, .followlist__follow');
  if (followBtn) {
    e.preventDefault();
    const me = currentUser();
    if (!me) return openAuth('login');
    const target = followBtn.getAttribute('data-target');
    if (!target) return;
    const overlayOn = isPostingAsOfficial();
    const effectiveHandle = overlayOn ? OFFICIAL_HANDLE : me.handle;
    if (target === effectiveHandle) return;
    followBtn.disabled = true;
    (async () => {
      let actorUserId;
      if (overlayOn) {
        let acct = cachedOfficialAccount();
        if (!acct) { try { acct = await getOfficialAccount(); } catch {} }
        actorUserId = acct?.id;
        if (!actorUserId) {
          alert('公式アカウントの読み込みに失敗しました。リロードしてもう一度お試しください。');
          return;
        }
      }
      const opts = overlayOn ? { actorUserId } : {};
      return toggleFollow(me.handle, target, opts);
    })()
      .then((res) => {
        if (!res) return; // overlay aborted above
        // toggleFollow returns { state: 'following' | 'requested' | 'none' }.
        const state = (res && res.state) || 'none';
        const isFollowed = state === 'following' || state === 'requested';
        followBtn.classList.toggle('is-following', isFollowed);
        followBtn.classList.toggle('btn--primary', !isFollowed);
        followBtn.classList.toggle('btn--ghost', isFollowed);
        followBtn.textContent = state === 'following' ? 'Following'
                              : state === 'requested' ? 'Requested'
                              :                          'Follow';
        // Re-render so any visible follower/following counts re-read the cache.
        refresh();
      })
      .catch((err) => alert('フォロー操作に失敗しました: ' + err.message))
      .finally(() => { followBtn.disabled = false; });
    return;
  }

  // Toggle the GitHub URL input on / off.
  const linkToggle = e.target.closest('#compose-link-toggle');
  if (linkToggle) {
    e.preventDefault();
    const row = document.getElementById('compose-link-row');
    if (!row) return;
    const willOpen = row.hidden;
    row.hidden = !willOpen;
    linkToggle.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) row.querySelector('input')?.focus();
    return;
  }
  // Same toggle shape for the connpass event URL input.
  const eventToggle = e.target.closest('#compose-event-toggle');
  if (eventToggle) {
    e.preventDefault();
    const row = document.getElementById('compose-event-row');
    if (!row) return;
    const willOpen = row.hidden;
    row.hidden = !willOpen;
    eventToggle.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) row.querySelector('input')?.focus();
    return;
  }

  // Clear the picked spot (the small × next to the chip).
  if (e.target.closest('#compose-spot-clear')) {
    e.preventDefault();
    pendingSpot = null;
    syncSpotChip(null);
    return;
  }

  // Open the spot picker (📍 tool button or the spot chip itself).
  const spotTrigger = e.target.closest('[data-spot-pick], #compose-spot-btn');
  if (spotTrigger) {
    e.preventDefault();
    pickSpot().then((result) => {
      if (!result) return;
      pendingSpot = result;
      syncSpotChip(result);
    });
    return;
  }

  // Click anywhere on a post card → open /post/<id>. Excludes the
  // interactive children that have their own behaviour (avatar/name/
  // handle links, action buttons, mention links, photo lightbox,
  // task checkboxes, poll vote buttons, the body text itself so the
  // user can still select-to-copy) and skips when there's an active
  // text selection. Also skipped when the click bubbled up from
  // inside a quoted-card inside another post (those have their own
  // navigation).
  if (!e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && e.button === 0) {
    const card = e.target.closest('.post[data-post-id]');
    if (card && !e.target.closest(
      // Bail out only for things that have their own click behaviour.
      // The body is INCLUDED so clicking anywhere on the text navigates
      // to the detail page; drag-select stays safe via the getSelection
      // check below.
      'a, button, input, textarea, label, ' +
      '.post__photo, .md-task__box, .poll, .quote-card, .post__edit-input'
    )) {
      const sel = window.getSelection && window.getSelection();
      const hasText = sel && sel.toString && sel.toString().length > 0;
      if (!hasText) {
        e.preventDefault();
        navigate('/post/' + card.getAttribute('data-post-id'));
        return;
      }
    }
  }

  // Click on the "コメント (N)" header → focus the comment textarea so
  // the keyboard pops without an extra tap.
  if (e.target.closest('.comment-list-head')) {
    const ta = document.querySelector('#comment-form textarea[name="body"]');
    if (ta) { e.preventDefault(); ta.focus(); return; }
  }

  // Click on a post photo → open the fullscreen lightbox at that index.
  // Pulls every photo from the same post card so the lightbox can
  // arrow / swipe between them.
  const photoImg = e.target.closest('.post__photo');
  if (photoImg) {
    e.preventDefault();
    const card = photoImg.closest('.post__photos');
    if (!card) return;
    const all = [...card.querySelectorAll('.post__photo')];
    const idx = all.indexOf(photoImg);
    const srcs = all.map(img => img.getAttribute('src')).filter(Boolean);
    import('./views/photo-lightbox.js').then(({ openLightbox }) => {
      openLightbox(srcs, Math.max(0, idx));
    });
    return;
  }

  // Idea tag toggle — flips pendingKind between null and 'idea' and
  // syncs the button's pressed/data-kind state so the next submit
  // picks up the new value.
  const kindBtn = e.target.closest('#compose-kind-toggle');
  if (kindBtn) {
    e.preventDefault();
    pendingKind = pendingKind === 'idea' ? null : 'idea';
    syncKindToggle();
    autosaveComposerDraft();
    return;
  }
  // (Visibility is now a <select> handled via the document 'change'
  // listener below — no click toggle.)

  // Chart tool — open the poll-attach modal. Modal resolves with
  // { question, options[], deadlineAt } on Confirm, { delete: true }
  // on Remove, null on Cancel.
  const pollBtn = e.target.closest('.composer .compose-tool[title="poll"]');
  if (pollBtn) {
    e.preventDefault();
    import('./views/poll-modal.js').then(({ openPollModal }) => {
      openPollModal(pendingPoll).then((res) => {
        if (res === null) return;            // cancel
        if (res.delete)   { pendingPoll = null; }
        else              { pendingPoll = res; }
        renderPollChip();
        autosaveComposerDraft();
      });
    });
    return;
  }
  // Click the chip itself to re-open / edit the attached poll.
  if (e.target.closest('#compose-poll-chip')) {
    e.preventDefault();
    import('./views/poll-modal.js').then(({ openPollModal }) => {
      openPollModal(pendingPoll).then((res) => {
        if (res === null) return;
        if (res.delete)   pendingPoll = null;
        else              pendingPoll = res;
        renderPollChip();
        autosaveComposerDraft();
      });
    });
    return;
  }

  // Vote on a poll option (rendered post body).
  const voteBtn = e.target.closest('.poll__opt');
  if (voteBtn) {
    e.preventDefault();
    const post = voteBtn.closest('[data-post-id]');
    const idx = Number(voteBtn.getAttribute('data-poll-idx'));
    if (!post || !Number.isFinite(idx)) return;
    const me = currentUser();
    if (!me) { openAuth('login'); return; }
    voteBtn.disabled = true;
    import('./data.js').then(({ votePoll }) => {
      votePoll(post.getAttribute('data-post-id'), idx)
        .then(() => refresh())
        .catch((err) => {
          alert(err.message || '投票に失敗しました');
          voteBtn.disabled = false;
        });
    });
    return;
  }

  // Code tool — insert a ``` fenced block at the textarea caret with
  // the caret landing on the inner blank line. Saves the user typing
  // the syntax (and gives a discoverability hint for Markdown).
  const codeBtn = e.target.closest('.composer .compose-tool[title="code"]');
  if (codeBtn) {
    e.preventDefault();
    const ta = document.querySelector('.composer textarea[name="text"]');
    if (!ta) return;
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const before = ta.value.slice(0, start);
    const after  = ta.value.slice(end);
    // Add surrounding newlines only if we're not already at a line break
    // — keeps fenced blocks formatted correctly in mid-paragraph paste.
    const lead  = !before || before.endsWith('\n') ? '' : '\n';
    const trail = !after  || after.startsWith('\n') ? '' : '\n';
    const insert = lead + '```\n\n```' + trail;
    ta.value = before + insert + after;
    const caret = (before + lead + '```\n').length;
    ta.setSelectionRange(caret, caret);
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  // Task list checkbox — toggle `- [ ]` ↔ `- [x]` in the source body
  // for own posts, persist via updatePost, leave the UI updated.
  // Non-author taps just preventDefault so the box never changes.
  const taskBox = e.target.closest('.post__body--editable-tasks .md-task__box');
  if (taskBox) {
    const post = taskBox.closest('[data-post-id]');
    if (!post) { e.preventDefault(); return; }
    const idx = Number(taskBox.dataset.taskIdx);
    if (!Number.isFinite(idx)) { e.preventDefault(); return; }
    e.preventDefault();
    // Build the new body from the CURRENT rendered checkboxes so we
    // can't drift if multiple boxes toggled in flight. Pull the raw
    // body via a hidden data attribute stamped on the post card.
    const postId = post.getAttribute('data-post-id');
    // Read the original markdown body from the post's data attribute,
    // toggling the n-th task.
    Promise.all([
      import('./markdown.js'),
      import('./data.js'),
    ]).then(([{ toggleTaskInBody }, { getPost, updatePost: updateP }]) => {
      // Get the current body. The render flow only stamps the rendered
      // HTML, not the raw markdown, so re-fetch the post to be safe.
      getPost(postId).then((p) => {
        if (!p) return;
        const next = toggleTaskInBody(p.body, idx);
        if (next === p.body) return;
        taskBox.disabled = true;
        updateP(postId, { body: next })
          .then(() => {
            taskBox.checked = !taskBox.checked;
            taskBox.disabled = false;
          })
          .catch((err) => {
            alert('チェック更新に失敗: ' + err.message);
            taskBox.disabled = false;
          });
      });
    });
    return;
  }

  // Photo button — trigger the hidden file input. Mobile browsers
  // honour `capture="environment"` so the rear camera opens by default
  // (the picker still lets you switch to the library).
  if (e.target.closest('#compose-photo-btn')) {
    e.preventDefault();
    const input = document.getElementById('compose-photo-input');
    if (input) input.click();
    return;
  }
  // Remove a single queued photo from the preview row.
  const removePhotoBtn = e.target.closest('.compose-photo__remove');
  if (removePhotoBtn) {
    e.preventDefault();
    const idx = Number(removePhotoBtn.getAttribute('data-idx'));
    if (Number.isFinite(idx)) {
      pendingPhotos.splice(idx, 1);
      renderPhotoPreviews();
    }
    return;
  }

  // Save draft button — persist whatever is in the composer to
  // localStorage, then flash the "Draft saved" banner. Works offline.
  if (e.target.closest('[data-compose-draft]')) {
    e.preventDefault();
    const state = readComposerState();
    if (!state) return;
    saveDraft(draftHandle(), state);
    showDraftBanner(t('home.composer.draft_saved'));
    return;
  }

  // Discard the draft — clears localStorage + wipes the composer UI.
  if (e.target.closest('[data-compose-draft-discard]')) {
    e.preventDefault();
    clearDraft(draftHandle());
    clearComposerUI();
    return;
  }

  // Push button fallback: in case form submit gets eaten elsewhere,
  // explicitly trigger the form when the submit button is clicked.
  const pushBtn = e.target.closest('.composer button[type="submit"]');
  if (pushBtn) {
    const form = pushBtn.closest('form.idea-form');
    if (form && !form.checkValidity()) return; // let HTML5 validation show
    if (form) {
      e.preventDefault();
      form.requestSubmit();
    }
  }
});

// Posting a new idea.
document.addEventListener('submit', (e) => {
  const form = e.target.closest('.idea-form');
  if (!form) return;
  e.preventDefault();
  const me = currentUser();
  if (!me) return openAuth('register');
  const ta = form.querySelector('textarea[name="text"]');
  const text = ta.value.trim();
  // Allow photo-only / poll-only posts: empty body is fine when there
  // IS an attachment (photo or poll). Empty + no attachment rejects.
  if (!text && !pendingPhotos.length && !pendingPoll) {
    ta.classList.add('is-error');
    ta.focus();
    return;
  }
  ta.classList.remove('is-error');
  const ghInput = form.querySelector('input[name="github"]');
  const gh = ghInput ? ghInput.value.trim() : '';
  // Event URL: accept any connpass URL form (with/without trailing
  // slash, /event/<id>/ or the older /event/<id>/participants/), and
  // normalise to the canonical /event/<id>/ before saving so all
  // rows sharing the same event group cleanly.
  const evInput = form.querySelector('input[name="event"]');
  const evRaw = evInput ? evInput.value.trim() : '';
  let eventUrl = '';
  if (evRaw) {
    const parsed = parseConnpassUrl(evRaw);
    if (parsed) eventUrl = parsed.url;
  }
  const spotValue = pendingSpot
    ? {
        lat: pendingSpot.lat,
        lng: pendingSpot.lng,
        label: pendingSpot.label || '',
        ...(pendingSpot.address ? { address: pendingSpot.address } : {}),
        ...(pendingSpot.addressDetails ? { addressDetails: pendingSpot.addressDetails } : {}),
      }
    : null;
  const post = {
    body: text,
    githubLink: gh || undefined,
    eventUrl:  eventUrl || undefined,
    status: 'wip',
  };
  if (spotValue) post.spot = spotValue;
  if (pendingPhotos.length) post.photos = pendingPhotos.slice();
  if (pendingPoll) post.poll = pendingPoll;
  if (pendingKind) post.kind = pendingKind;
  if (pendingVisibility && pendingVisibility !== 'public') post.visibility = pendingVisibility;

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  addPost(post)
    .then((created) => {
      // Optimistically inject the new row into every timeline cache
      // it could surface in — home, the author's profile, and the
      // spot view if it's spot-tagged. The next renderXxx() reads
      // from cache first, so the user sees the post immediately
      // even if the Supabase read replica hasn't caught up yet.
      // Without this, refresh() below could re-fetch from a replica
      // that still doesn't see the just-inserted row, and the
      // timeline would silently rebuild without the new post.
      if (created) prependToTimelineCaches(created);
      clearDraft(draftHandle());
      clearComposerUI();
      refresh();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    })
    .catch((err) => alert('投稿に失敗しました: ' + err.message))
    .finally(() => { if (submitBtn) submitBtn.disabled = false; });
});

// Auto-grow the composer textarea as the user types, and drop the
// "this field can't be empty" error state once they start typing again.
document.addEventListener('input', (e) => {
  const el = e.target;
  // Textarea: auto-grow + clear error + autosave draft.
  if (el instanceof HTMLTextAreaElement && el.closest('.composer')) {
    el.classList.remove('is-error');
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 320) + 'px';
    hideDraftBanner();
    autosaveComposerDraft();
    return;
  }
  // GitHub URL field: just autosave so the draft picks up the link too.
  if (el instanceof HTMLInputElement && el.closest('.composer') && el.name === 'github') {
    hideDraftBanner();
    autosaveComposerDraft();
  }
});

// ----- keyboard shortcuts -----
function isTyping(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

document.addEventListener('keydown', (e) => {
  // "/" focuses the topbar search (matches the kbd hint shown next to it).
  if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) {
    const search = document.querySelector('.topbar__search input');
    if (search) {
      e.preventDefault();
      search.focus();
      search.select();
    }
    return;
  }

  // Cmd/Ctrl+Enter submits the composer while focused inside the textarea.
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    const ta = e.target;
    if (ta instanceof HTMLTextAreaElement && ta.closest('.idea-form')) {
      e.preventDefault();
      ta.form?.requestSubmit();
    }
  }
});

// ----- service worker (PWA) -----
// Register only on http(s); file:// (Electron) doesn't support SW.
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // SPA navigation is client-side (pushState + dispatch), so the
      // browser never re-fetches HTML and never notices when a new
      // sw.js is deployed. Poll for an update on route changes so a
      // fresh deploy takes effect without a hard reload — but throttle
      // to once per 10 minutes: reg.update() is a real network fetch
      // of sw.js, and firing it on every single navigation added
      // per-page lag on slow connections.
      const SW_CHECK_MS = 10 * 60 * 1000;
      let lastSwCheck = Date.now(); // register() itself just checked
      onRoute(() => {
        if (Date.now() - lastSwCheck < SW_CHECK_MS) return;
        lastSwCheck = Date.now();
        reg.update().catch(() => {});
      });
      // When a NEW SW takes over (fresh cache), reload once so the
      // page runs against the code it was compiled with. Guard with
      // sessionStorage so the reload can't loop.
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return;
        reloaded = true;
        try {
          if (sessionStorage.getItem('spotcode:sw-reloaded') === '1') return;
          sessionStorage.setItem('spotcode:sw-reloaded', '1');
        } catch {}
        location.reload();
      });
    }).catch(() => {});
  });
}
