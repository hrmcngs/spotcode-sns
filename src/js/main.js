import { initThemeToggle } from './theme.js';
import { renderGrass }     from './grass.js';
import { onRoute, url, refresh, navigate } from './router.js';
import { renderHome, hydrateHome } from './views/home.js';
import { renderProfile, hydrateProfileBadges, hydrateProfileActivity, hydrateProfile, setProfileTab } from './views/profile.js';
import { renderStub }      from './views/stub.js';
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
import { allUsers, allPosts, addPost, removePost, updatePost, probeSchema } from './data.js';
import { currentUser, logout, onAuthChange, initAuth } from './auth.js';
import { icon }            from './icons.js';
import { toggleLike, isLiked, likeCount,
         toggleFollow, isFollowing,
         toggleRepost, toggleBookmark,
         hydrateMyFollows, clearInteractionsCache } from './interactions.js';
import { renderAvatar, fileToPhotoDataUrl } from './avatar.js';
import { initDevMode, isDevMode } from './dev-mode.js';
import { romajiToJp, jpToRomaji } from './jp-romaji.js';
import { initI18n, t }            from './i18n.js';
import { initIosZoomGuard }       from './ios-zoom.js';
import { lockBodyScroll, unlockBodyScroll, forceUnlockBodyScroll } from './body-scroll-lock.js';
import { fetchContributions, cachedContributions } from './github-activity.js';
import { saveDraft, loadDraft, clearDraft, debounce } from './drafts.js';
import { quickNavLinks } from './quick-nav.js';
import { initMentionAutocomplete } from './mention-autocomplete.js';

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

function dispatch(path) {
  // If a modal closed without unlocking (uncaught error path, navigation
  // mid-animation, …) the body would still be position:fixed and the
  // next page would render shifted. Force-clear once on every nav.
  forceUnlockBodyScroll();
  const stubMatch      = path.match(/^\/(repos)\/?$/);
  const mapMatch       = path === '/spots' || path === '/spots/';
  const mapCityMatch   = path.match(/^\/spots\/(.+?)\/?$/);
  const spotMatch      = path.match(/^\/spot\/(.+?)\/?$/);
  const analyticsMatch = path.match(/^\/post\/([0-9a-fA-F-]{36})\/analytics\/?$/);
  const postMatch      = path.match(/^\/post\/([0-9a-fA-F-]{36})\/?$/);
  const followMatch    = path.match(/^\/([A-Za-z0-9_]+)\/(following|followers)\/?$/);
  const userMatch      = path.match(/^\/([A-Za-z0-9_]+)\/?$/);

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
    app.innerHTML =
      '<div class="stub">' +
        '<h2 class="stub__title">ページが見つかりません</h2>' +
        '<p class="stub__sub">URL が間違っているか、削除されたページです。</p>' +
      '</div>' +
      quickNavLinks();
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
  pendingPhotos = [];
  renderPhotoPreviews();
  pendingPoll = null;
  renderPollChip();
  hideDraftBanner();
}

// Re-render the small pill that announces "📊 投票が添付されています"
// in the composer, mirroring the spot-chip pattern. Click → re-open
// the poll modal to edit.
function renderPollChip() {
  let chip = document.getElementById('compose-poll-chip');
  if (!pendingPoll) { if (chip) chip.remove(); return; }
  const labelOpts = pendingPoll.options.slice(0, 2).join(' / ') +
    (pendingPoll.options.length > 2 ? ` …+${pendingPoll.options.length - 2}` : '');
  const html =
    '<button type="button" class="spot-chip spot-chip--set" id="compose-poll-chip" title="クリックして編集">' +
      '📊 投票: ' + labelOpts +
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
    if (!confirm('ログアウトしますか？')) return;
    logout().finally(() => navigate('/'));
    return;
  }

  // Per-comment delete button on the post detail page.
  const cdel = e.target.closest('[data-comment-delete]');
  if (cdel) {
    e.preventDefault();
    handleCommentDelete(cdel.getAttribute('data-comment-delete'));
    return;
  }

  // Inline Accept / Deny on the notifications view's follow-request rows.
  if (handleNotifAction(e)) return;
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

  // Enter edit mode — swap the post body for a textarea + Save/Cancel.
  // Only rendered on own posts, so no extra owner check needed here.
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
    body.innerHTML =
      '<textarea class="post__edit-input" rows="3">' +
        // textareas treat raw text only — escape isn't needed because
        // the browser handles it, but we do need < / & sanitised.
        String(original).replace(/&/g, '&amp;').replace(/</g, '&lt;') +
      '</textarea>' +
      '<div class="post__edit-actions">' +
        '<button type="button" class="btn btn--ghost btn--sm act--edit-cancel">キャンセル</button>' +
        '<button type="button" class="btn btn--primary btn--sm act--edit-save">保存</button>' +
      '</div>';
    const ta = body.querySelector('textarea');
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
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
    saveBtn.disabled = true;
    ta.disabled = true;
    updatePost(post.getAttribute('data-post-id'), { body: newBody })
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
        });
      })
      .catch((err) => {
        alert('編集に失敗しました: ' + err.message);
        saveBtn.disabled = false;
        ta.disabled = false;
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
  if (pendingPhotos.length) post.photos = pendingPhotos.slice();
  if (pendingPoll) post.poll = pendingPoll;

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
