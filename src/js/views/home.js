import { renderIdeaForm } from '../idea-post.js';
import { allPosts, followingPosts, hydrateQuotedPosts, cachedPosts } from '../data.js';
import { renderPost }     from '../post.js';
import { currentUser }    from '../auth.js';
import { url }            from '../router.js';
import { hydratePostLikes, hydrateRepostsMine, hydrateBookmarksMine, hydratePolls } from '../interactions.js';
import { t }              from '../i18n.js';
import { renderTimelineSkeleton } from '../skeleton.js';
import { timelineTabs } from './timeline-tabs.js';

// Monotonic counter incremented on every renderHome() so async hydrations
// can detect when they've been superseded by a newer navigation / refresh
// and skip their DOM mutation. Without this, a slow fetch from an earlier
// dispatch could overwrite the freshly-rendered timeline from a newer
// dispatch, making posts visibly disappear "sometimes".
let renderVersion = 0;

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
  return [
    timelineTabs(tab),
    renderIdeaForm({ user: currentUser() }),
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
  // Logged-out Following tab — skip the network round trip, show
  // the sign-in CTA directly.
  if (tab === 'following' && !me) {
    list.innerHTML = emptyTimeline('following', false);
    return;
  }

  let posts;
  try {
    posts = tab === 'following' ? await followingPosts() : await allPosts();
  } catch (err) {
    if (myVersion !== renderVersion) return;
    console.error('hydrateHome: fetch failed', err);
    list.innerHTML = errorTimeline(err.message || '通信エラー');
    return;
  }
  if (myVersion !== renderVersion) return;

  if (!posts.length) {
    list.innerHTML = emptyTimeline(tab, !!me);
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
  } catch (err) {
    console.warn('hydrate batch failed', err);
    return;
  }
  if (myVersion !== renderVersion) return;
  list.innerHTML = posts.map(renderPost).join('');
  hydratePolls(posts).catch(() => {});
}
