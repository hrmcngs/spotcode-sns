import { watchTimelineEnd } from '../timeline-scroll.js';
import { renderIdeaForm } from '../idea-post.js';
import { forYouPage, followingPosts, hydrateQuotedPosts, cachedPosts } from '../data.js';
import { renderPost }     from '../post.js';
import { currentUser }    from '../auth.js';
import { displayUser }    from '../posting-identity.js';
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
          ("<h2 class=\"stub__title\">" + t("サインインしてください") + "</h2>") +
          ("<p class=\"stub__sub\">" + t("フォロー中の人の投稿を見るにはサインインが必要です。") + "</p>") +
          ("<button class=\"btn btn--primary\" data-auth=\"login\">" + t("Log in") + "</button>") +
        '</div>'
      );
    }
    return (
      '<div class="stub">' +
        ("<h2 class=\"stub__title\">" + t("まだフォローしている人がいません") + "</h2>") +
        ("<p class=\"stub__sub\">" + t("気になる人をフォローすると、その人の投稿だけがここに集まります。") + "</p>") +
        '<a class="back-home" href="' + url('/') + ("\">" + t("For you を見る") + "</a>") +
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
    const markup = cached.map(renderPost).join('');
    if (markup) return '<div id="timeline-list-cached">' + markup + '</div>';
  }
  return renderTimelineSkeleton(4);
}

function errorTimeline(msg) {
  const safe = String(msg).replace(/[&<>]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;' }[c]));
  return (
    '<div class="stub">' +
      '<h2 class="stub__title">' + t('home.error.title') + '</h2>' +
      '<p class="stub__sub">' + safe + '</p>' +
      '<button type="button" class="btn btn--ghost" data-timeline-retry>' + t("再試行") + '</button>' +
    '</div>'
  );
}

function showTimelineError(list, error, retry) {
  list.innerHTML = errorTimeline(error.message || t("通信エラー"));
  list.querySelector('[data-timeline-retry]')?.addEventListener('click', () => {
    list.innerHTML = renderTimelineSkeleton(4);
    void retry();
  }, { once: true });
}

// `tab` ∈ { 'foryou', 'following' }. Default 'foryou' for backwards-
// compat with any caller that doesn't pass the arg.
export function renderHome(tab = 'foryou') {
  renderVersion++;
  timelineObserver?.disconnect();
  timelineObserver = null;
  return [
    '<header class="journal-hero">',
      '<h1>spotcode</h1>',
      '<p>' + t('みんなの活動') + '</p>',
    '</header>',
    '<section class="journal-directory" aria-label="' + t('活動を見る') + '">',
      '<details class="journal-compose">',
        '<summary><strong>' + t('投稿を書く') + '</strong><span>' + t('アイデアや進捗を残す') + '</span><span aria-hidden="true">↗</span></summary>',
        renderIdeaForm({ user: displayUser(currentUser()) }),
      '</details>',
    '</section>',
    timelineTabs(tab),
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

  const active = () => myVersion === renderVersion && list.isConnected && currentUser()?.id === me?.id;
  const paint = posts => {
    const markup = posts.map(renderPost).join('');
    list.innerHTML = markup || emptyTimeline(tab, !!me);
  };
  try {
    // Always refresh Following after navigation: the follow list and audience
    // can change while the previous snapshot is still inside its cache TTL.
    const posts = await withTimeout(followingPosts({ limit: 40 }), TIMELINE_TIMEOUT_MS, t("タイムライン取得"));
    if (!active()) return;
    paint(posts);
    const ids = posts.map(p => p.id);
    // Supplementary requests must never prevent the timeline from displaying.
    Promise.allSettled([
      hydratePostLikes(ids), hydrateRepostsMine(ids),
      hydrateBookmarksMine(ids), hydrateQuotedPosts(posts),
    ]).then(() => {
      if (!active()) return;
      paint(posts);
      hydratePolls(posts).catch(() => {});
    }).catch(err => {
      if (active()) showTimelineError(list, err, () => hydrateHome(tab));
    });
  } catch (err) {
    if (active()) showTimelineError(list, err, () => hydrateHome(tab));
  }
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
    if (button) { button.hidden = true; status.textContent = t("読み込み中…"); }
    try {
      const page = await withTimeout(forYouPage({ before: cursor }), TIMELINE_TIMEOUT_MS, t("タイムライン取得"));
      if (!active()) return;
      if (first) {
        list.innerHTML = ("<div data-timeline-feed></div><p data-timeline-status role=\"status\"></p><div data-timeline-end aria-hidden=\"true\" style=\"height:1px\"></div><button type=\"button\" class=\"btn btn--ghost\" data-timeline-more hidden>" + t("再試行") + "</button>");
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
      if (!feed.textContent.trim() && !hasMore) feed.innerHTML = emptyTimeline('foryou', !!owner);
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
      if (first) { showTimelineError(list, error, load); return; }
      autoPaused = true;
      status.textContent = t("続きを取得できませんでした。再試行してください。");
    } finally {
      loading = false;
      if (active() && button) { button.disabled = false; button.hidden = !autoPaused; }
      if (active() && sentinel && hasMore && !autoPaused) {
        if (!watcher) {
          watcher = watchTimelineEnd(sentinel, { active, load: () => { if (!autoPaused) void load(); } });
          timelineObserver = watcher;
        }
        watcher.check();
      }
    }
  };
  await load();

}
