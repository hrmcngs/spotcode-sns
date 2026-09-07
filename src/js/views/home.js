import { watchTimelineEnd } from '../timeline-scroll.js';
import { renderIdeaForm } from '../idea-post.js';
import { allPosts, forYouPage, followingPosts, hydrateQuotedPosts, cachedPosts } from '../data.js';
import { renderPost }     from '../post.js';
import { currentUser }    from '../auth.js';
import { displayUser }    from '../posting-identity.js';
import { url }            from '../router.js';
import { hydratePostLikes, hydrateRepostsMine, hydrateBookmarksMine, hydratePolls } from '../interactions.js';
import { t }              from '../i18n.js';
import { renderTimelineSkeleton } from '../skeleton.js';
import { timelineTabs } from './timeline-tabs.js';
import { withTimeout } from '../net-utils.js';

// Covers SDK loading, auth refresh queues, a cold Supabase wake-up, and the
// PostgREST request itself. 15 seconds was too aggressive on cellular and
// showed an error while a valid request was still finishing in the
// background. Keep a deadline, but leave enough room for slow mobile links.
const TIMELINE_TIMEOUT_MS = 45 * 1000;

// Monotonic counter incremented on every renderHome() so async hydrations
// can detect when they've been superseded by a newer navigation / refresh
// and skip their DOM mutation. Without this, a slow fetch from an earlier
// dispatch could overwrite the freshly-rendered timeline from a newer
// dispatch, making posts visibly disappear "sometimes".
let renderVersion = 0;
let timelineObserver = null;

// Per-tab cache scope keys for the timeline localStorage cache.
const SCOPE = { foryou: 'home', following: 'following' };

function emptyTimeline(tab, loggedIn) {
  if (tab === 'following') {
    if (!loggedIn) {
      return (
        '<div class="stub">' +
          '<h2 class="stub__title">サインインしてください</h2>' +
          '<p class="stub__sub">フォロー中の人の投稿を見るにはサインインが必要です。</p>' +
          '<button class="btn btn--primary" data-auth="login">Log in</button>' +
        '</div>'
      );
    }
    return (
      '<div class="stub">' +
        '<h2 class="stub__title">まだフォローしている人がいません</h2>' +
        '<p class="stub__sub">気になる人をフォローすると、その人の投稿だけがここに集まります。</p>' +
        '<a class="back-home" href="' + url('/') + '">For you を見る</a>' +
      '</div>'
    );
  }
  return (
    '<div class="stub">' +
      '<h2 class="stub__title">' + t('home.empty.title') + '</h2>' +
      '<p class="stub__sub">' +
        (loggedIn ? t('home.empty.signed_in') : t('home.empty.guest')) +
      '</p>' +
    '</div>'
  );
}

function loadingTimeline(tab) {
  // If we have a cached timeline from a previous visit OF THE SAME
  // tab, paint that immediately. Otherwise show the skeleton. Either
  // way, hydrateHome will refresh with live data.
  const cached = cachedPosts(SCOPE[tab] || 'home');
  if (cached && cached.length) {
    return '<div id="timeline-list-cached">' + cached.map(renderPost).join('') + '</div>';
  }
  return renderTimelineSkeleton(4);
}

function errorTimeline(msg) {
  const safe = String(msg).replace(/[&<>]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c]));
  return (
    '<div class="stub">' +
      '<h2 class="stub__title">' + t('home.error.title') + '</h2>' +
      '<p class="stub__sub">' + safe + '</p>' +
      '<button type="button" class="btn btn--ghost" onclick="location.reload()">' + t('home.error.reload') + '</button>' +
    '</div>'
  );
}

// `tab` ∈ { 'foryou', 'following' }. Default 'foryou' for backwards-
// compat with any caller that doesn't pass the arg.
export function renderHome(tab = 'foryou') {
  renderVersion++;
  timelineObserver?.disconnect();
  timelineObserver = null;
  return [
    timelineTabs(tab),
    renderIdeaForm({ user: displayUser(currentUser()) }),
    '<div id="timeline-list">',
      loadingTimeline(tab),
    '</div>',
  ].join('');
}

// Fetch + paint posts for the given tab. Guards every DOM write
// against `renderVersion` so stale fetches don't clobber a fresh
// render. `following` queries the followingPosts() helper which
// returns [] for guests or for users following no-one.
export async function hydrateHome(tab = 'foryou') {
  const myVersion = renderVersion;
  const list = document.getElementById('timeline-list');
  if (!list) return;

  const me = currentUser();
  if (tab === 'foryou') return hydrateForYou(list, myVersion, me?.id);
  // Logged-out Following tab — skip the network round trip, show
  // the sign-in CTA directly.
  if (tab === 'following' && !me) {
    list.innerHTML = emptyTimeline('following', false);
    return;
  }

  // Fresh-cache fast path: when this tab's timeline was fetched less
  // than a minute ago (typically: the user bounced to another page
  // and came right back), reuse it instead of re-downloading ~100
  // rows on every single visit. The likes/reposts/quotes hydration
  // below still runs, so counts and toggle state stay accurate.
  const FRESH_MS = 60 * 1000;
  let posts = cachedPosts(SCOPE[tab] || 'home', FRESH_MS);
  // A cache restored from localStorage has its photos stripped
  // (photosStripped) — never fetch-skip on that, or photo posts would
  // stay imageless after a quick reload.
  const usedFreshCache = !!(posts && posts.length && !posts.some(p => p && p.photosStripped));
  if (!usedFreshCache) {
    // Post rows can carry base64 photos (80–180KB each). The old desktop
    // limit of 100 made the web build download and parse a multi-MB response,
    // while mobile (40 rows) loaded correctly. Keep the initial page bounded
    // on every viewport; newest posts, including the keep-alive post, remain
    // visible without making desktop wait for 2.5x more data.
    const limit = 40;
    try {
      const request = tab === 'following'
        ? followingPosts({ limit })
        : allPosts({ limit });
      posts = await withTimeout(request, TIMELINE_TIMEOUT_MS, 'タイムライン取得');
    } catch (err) {
      if (myVersion !== renderVersion) return;
      console.error('hydrateHome: fetch failed', err);
      list.innerHTML = errorTimeline(err.message || '通信エラー');
      return;
    }
  }
  if (myVersion !== renderVersion) return;

  if (!posts.length) {
    list.innerHTML = emptyTimeline(tab, !!me);
    return;
  }
  // Skip the pre-hydration paint when the fresh-cache path was taken
  // AND renderHome already painted the exact same cached posts — the
  // post-hydration re-render below still lands the accurate counts.
  if (!(usedFreshCache && document.getElementById('timeline-list-cached'))) {
    list.innerHTML = posts.map(renderPost).join('');
  }

  const ids = posts.map(p => p.id);
  try {
    await Promise.all([
      hydratePostLikes(ids),
      hydrateRepostsMine(ids),
      hydrateBookmarksMine(ids),
      hydrateQuotedPosts(posts),
    ]);
  } catch (err) {
    console.warn('hydrate batch failed', err);
    return;
  }
  if (myVersion !== renderVersion) return;
  list.innerHTML = posts.map(renderPost).join('');
  hydratePolls(posts).catch(() => {});
}

async function hydrateForYou(list, version, owner) {
  let cursor = null, loading = false, first = true, hasMore = true;
  const seen = new Set();
  const active = () => version === renderVersion && list.isConnected && currentUser()?.id === owner;
  let feed, button, status, sentinel, watcher;
  let autoPaused = false;
  const load = async () => {
    if (loading || !hasMore || !active()) return;
    loading = true;
    if (button) { button.hidden = true; status.textContent = '読み込み中…'; }
    try {
      const page = await withTimeout(forYouPage({ before: cursor }), TIMELINE_TIMEOUT_MS, 'タイムライン取得');
      if (!active()) return;
      if (first) {
        list.innerHTML = '<div data-timeline-feed></div><p data-timeline-status role="status"></p><div data-timeline-end aria-hidden="true" style="height:1px"></div><button type="button" class="btn btn--ghost" data-timeline-more hidden>再試行</button>';
        feed = list.querySelector('[data-timeline-feed]');
        button = list.querySelector('[data-timeline-more]');
        status = list.querySelector('[data-timeline-status]');
        sentinel = list.querySelector('[data-timeline-end]');
        button.addEventListener('click', () => { autoPaused = false; void load(); });
        first = false;
      }
      cursor = page.cursor;
      hasMore = page.hasMore && !!cursor;
      const added = page.posts.filter(post => { if (seen.has(post.id)) return false; seen.add(post.id); return true; });
      const batch = document.createElement('div');
      batch.innerHTML = added.map(renderPost).join('');
      feed.append(batch);
      if (!seen.size && !hasMore) feed.innerHTML = emptyTimeline('foryou', !!owner);
      autoPaused = false;
      status.textContent = '';
      sentinel.hidden = !hasMore;
      // Update only this page so editing/expanded content in older pages survives.
      const ids = added.map(p => p.id);
      Promise.all([hydratePostLikes(ids), hydrateRepostsMine(ids), hydrateBookmarksMine(ids), hydrateQuotedPosts(added)])
        .then(() => { if (active() && batch.isConnected) { batch.innerHTML = added.map(renderPost).join(''); hydratePolls(added).catch(() => {}); } })
        .catch(() => {});
    } catch (error) {
      if (!active()) return;
      if (first) { list.innerHTML = errorTimeline(error.message || '通信エラー'); return; }
      autoPaused = true;
      status.textContent = '続きを取得できませんでした。再試行してください。';
    } finally {
      loading = false;
      if (active() && button) { button.disabled = false; button.hidden = !autoPaused; }
      if (active() && hasMore && !autoPaused) watcher?.check();
    }
  };
  await load();
  if (active() && sentinel && hasMore) {
    watcher = watchTimelineEnd(sentinel, { active, load: () => { if (!autoPaused) void load(); } });
    timelineObserver = watcher;
  }
}
