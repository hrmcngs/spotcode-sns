import { initThemeToggle } from './theme.js';
import { renderGrass }     from './grass.js';
import { onRoute, url, refresh, navigate } from './router.js';
import { renderHome, hydrateHome } from './views/home.js';
import { renderProfile, hydrateProfileBadges, hydrateProfileActivity, hydrateProfile, setProfileTab } from './views/profile.js';
import { renderStub }      from './views/stub.js';
import { renderSpot, hydrateSpot } from './views/spot.js';
import { renderMap, hydrateMap }  from './views/map.js';
import { renderRequests, hydrateRequests } from './views/requests.js';
import { renderFollowList, hydrateFollowList } from './views/follow-list.js';
import { renderSettings, bindSettings } from './views/settings.js';
import { pickSpot }        from './views/spot-picker.js';
import { openAuth }        from './views/auth-modal.js';
import { openEditProfile } from './views/edit-profile-modal.js';
import { openReport }      from './views/report-modal.js';
import { initSearch }      from './views/search-dropdown.js';
import { allUsers, allPosts, addPost, removePost } from './data.js';
import { currentUser, logout, onAuthChange, initAuth } from './auth.js';
import { icon }            from './icons.js';
import { toggleLike, isLiked, likeCount,
         toggleFollow, isFollowing,
         hydrateMyFollows, clearInteractionsCache } from './interactions.js';
import { renderAvatar } from './avatar.js';
import { initDevMode, isDevMode } from './dev-mode.js';
import { romajiToJp, jpToRomaji } from './jp-romaji.js';
import { initI18n, t }            from './i18n.js';
import { initIosZoomGuard }       from './ios-zoom.js';
import { lockBodyScroll, unlockBodyScroll, forceUnlockBodyScroll } from './body-scroll-lock.js';
import { fetchContributions, cachedContributions } from './github-activity.js';
import { saveDraft, loadDraft, clearDraft, debounce } from './drafts.js';

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
async function computeTrendingCities() {
  const byCity = new Map(); // city -> { city, prefecture, count }
  const posts = await allPosts({ limit: 200 });
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

async function renderRail() {
  const me = currentUser();
  // Make sure followsMine is filled before deciding who to suggest, so the
  // "Who to follow" list never re-suggests someone you already follow.
  try { await hydrateMyFollows(); } catch {}
  const others = Object.values(allUsers()).filter(u => {
    if (!me) return true; // guest: don't hide anyone
    if (u.handle === me.handle) return false;
    return !isFollowing(me.handle, u.handle);
  });
  const trending = await computeTrendingCities();

  // Pull the viewer's real GitHub contributions for the activity heatmap.
  // If they're not logged in, or haven't linked a github_handle, fall back
  // to the empty grid so the card still renders. Cached after first fetch.
  const gh = me?.github?.handle;
  const myCounts = gh ? (cachedContributions(gh) || emptyCounts) : emptyCounts;
  if (gh && !cachedContributions(gh)) {
    // Fetch in the background and re-render once it lands.
    fetchContributions(gh).then((c) => { if (c) refresh(); });
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
            '<a class="trend-item" href="' + url('/spot/' + encodeURIComponent(jpToRomaji(s.city) || s.city)) + '">' +
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
            const f = me && isFollowing(me.handle, u.handle);
            return (
              '<div class="followlist__row">' +
                renderAvatar(u, { tag: 'a', href: url('/' + u.handle) }) +
                '<div class="followlist__text">' +
                  '<a class="followlist__name" href="' + url('/' + u.handle) + '" title="' + escape(u.name) + '">' + escape(u.name) + '</a>' +
                  '<a class="followlist__handle" href="' + url('/' + u.handle) + '">@' + u.handle + '</a>' +
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
  const me = currentUser();
  if (me) {
    slot.innerHTML = renderAvatar(me, { tag: 'a', href: url('/' + me.handle), size: 'me', title: me.name });
  } else {
    slot.innerHTML =
      '<button class="btn btn--primary btn--sm" data-auth="login">' + t('nav.login') + '</button>';
  }
}

function renderSideMe() {
  const slot = document.getElementById('side-me');
  if (!slot) return;
  const me = currentUser();
  if (me) {
    slot.innerHTML =
      '<a class="me-card" href="' + url('/' + me.handle) + '">' +
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
  // Profile side-nav item: link to own profile when logged in,
  // otherwise turn it into a login trigger.
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

// Spot picked in the composer for the current home view, kept in memory
// so the timeline can re-render without losing the chosen pin.
let pendingSpot = null;

function dispatch(path) {
  // If a modal closed without unlocking (uncaught error path, navigation
  // mid-animation, …) the body would still be position:fixed and the
  // next page would render shifted. Force-clear once on every nav.
  forceUnlockBodyScroll();
  const stubMatch   = path.match(/^\/(explore|repos|notifications)\/?$/);
  const mapMatch    = path === '/spots' || path === '/spots/';
  const spotMatch   = path.match(/^\/spot\/(.+?)\/?$/);
  const followMatch = path.match(/^\/([A-Za-z0-9_]+)\/(following|followers)\/?$/);
  const userMatch   = path.match(/^\/([A-Za-z0-9_]+)\/?$/);

  if (path === '/' || path === '') {
    document.title = 'spotcode-sns';
    app.innerHTML = renderHome();
    restoreComposerDraft();
    if (pendingSpot) syncSpotChip(pendingSpot);
    hydrateHome();
  } else if (path === '/settings') {
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
  } else if (mapMatch) {
    document.title = 'Map / spotcode-sns';
    app.innerHTML = renderMap();
    hydrateMap();
  } else if (path === '/requests' || path === '/requests/') {
    document.title = 'Requests / spotcode-sns';
    app.innerHTML = renderRequests();
    hydrateRequests();
  } else if (stubMatch) {
    document.title = stubMatch[1] + ' / spotcode-sns';
    app.innerHTML = renderStub(stubMatch[1]);
  } else if (userMatch) {
    const handle = userMatch[1];
    document.title = '@' + handle + ' / spotcode-sns';
    app.innerHTML = renderProfile(handle);
    // Fetch from Supabase if we don't have the user locally, then hit
    // GitHub for badges once we know the github_handle on the profile.
    hydrateProfile(handle).then(() => {
      hydrateProfileBadges(handle);
      hydrateProfileActivity(handle);
    });
  } else {
    document.title = 'Not found / spotcode-sns';
    app.innerHTML = '<div class="stub"><h2 class="stub__title">Not found</h2><a class="back-home" href="/">← Back to home</a></div>';
  }
  renderRail().then((html) => { rail.innerHTML = html; });
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
  return {
    body:       ta ? ta.value : '',
    githubLink: gh ? gh.value : '',
    spot:       pendingSpot,
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
  const row = document.getElementById('compose-link-row');
  if (row) row.hidden = true;
  const linkToggle = document.getElementById('compose-link-toggle');
  if (linkToggle) linkToggle.setAttribute('aria-expanded', 'false');
  pendingSpot = null;
  syncSpotChip(null);
  hideDraftBanner();
}

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
  if (d.spot && d.spot.lat != null && d.spot.lng != null) {
    pendingSpot = d.spot;
    syncSpotChip(d.spot);
  }
  showDraftBanner();
}

initThemeToggle(document.getElementById('theme-toggle'));

// Restore the Supabase session (if any) before the first render so the
// app doesn't flash a logged-out state to a returning user. Failures here
// (Supabase down, no network) leave cachedUser null — the app still works
// as a logged-out static site.
try { await initAuth(); } catch (err) { console.warn('initAuth failed', err); }
// Once logged in, pre-load the set of handles I follow so isFollowing()
// can answer synchronously from the render path.
hydrateMyFollows();
// Apply the dev-mode html[data-dev] flag so dev-only CSS can scope its
// chrome (e.g. the dev-mode topbar indicator) without flashing.
initDevMode();
initI18n();
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

onAuthChange(() => {
  // The signed-in identity changed (login / logout / profile update) —
  // drop the like/follow cache so the next renders re-fetch with the
  // right `auth.uid()` context, then warm the new user's follows.
  clearInteractionsCache();
  hydrateMyFollows();
  renderAuthArea();
  renderSideMe();
  refresh();
});

// ----- delegated UI events -----

// When the composer textarea takes focus (click, tab key, or the
// New idea button), scroll it into view so the sticky topbar + tab
// bar don't cover its top half. `scroll-margin-top` on the element
// itself takes care of the offset.
document.addEventListener('focusin', (e) => {
  const ta = e.target;
  if (!(ta instanceof HTMLTextAreaElement)) return;
  if (!ta.closest('.composer')) return;
  ta.scrollIntoView({ block: 'start', behavior: 'smooth' });
});

document.getElementById('open-compose')?.addEventListener('click', () => {
  if (!currentUser()) return openAuth('register');
  navigate('/');
  setTimeout(() => {
    document.querySelector('.composer textarea')?.focus();
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
  if (e.target.closest('#logout-btn')) {
    e.preventDefault();
    logout().finally(() => navigate('/'));
    return;
  }
  if (e.target.closest('#edit-profile-btn')) {
    e.preventDefault();
    if (!currentUser()) return openAuth('login');
    openEditProfile();
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

  // Delete own post (trash button — only rendered on own posts).
  const deleteBtn = e.target.closest('.act--delete');
  if (deleteBtn) {
    e.preventDefault();
    const post = deleteBtn.closest('[data-post-id]');
    if (!post) return;
    if (!confirm('この投稿を削除しますか？元に戻せません。')) return;
    deleteBtn.disabled = true;
    // Optimistically fade the card so the user sees an immediate response,
    // then drop it from the DOM on success or restore on error.
    post.style.opacity = '.4';
    post.style.pointerEvents = 'none';
    removePost(post.getAttribute('data-post-id'))
      .then(() => { post.remove(); })
      .catch((err) => {
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

  // Follow / unfollow (profile + Who-to-follow).
  const followBtn = e.target.closest('.btn--follow, .followlist__follow');
  if (followBtn) {
    e.preventDefault();
    const me = currentUser();
    if (!me) return openAuth('login');
    const target = followBtn.getAttribute('data-target');
    if (!target || target === me.handle) return;
    followBtn.disabled = true;
    toggleFollow(me.handle, target)
      .then((now) => {
        followBtn.classList.toggle('is-following', now);
        followBtn.classList.toggle('btn--primary', !now);
        followBtn.classList.toggle('btn--ghost', now);
        followBtn.textContent = now ? 'Following' : 'Follow';
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
  if (!text) {
    ta.classList.add('is-error');
    ta.focus();
    return;
  }
  ta.classList.remove('is-error');
  const ghInput = form.querySelector('input[name="github"]');
  const gh = ghInput ? ghInput.value.trim() : '';
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
    status: 'wip',
  };
  if (spotValue) post.spot = spotValue;

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  addPost(post)
    .then(() => {
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
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
