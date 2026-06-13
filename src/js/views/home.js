import { renderIdeaForm } from '../idea-post.js';
import { allPosts }       from '../data.js';
import { renderPost }     from '../post.js';
import { currentUser }    from '../auth.js';
import { hydratePostLikes } from '../interactions.js';
import { t }              from '../i18n.js';

// Monotonic counter incremented on every renderHome() so async hydrations
// can detect when they've been superseded by a newer navigation / refresh
// and skip their DOM mutation. Without this, a slow fetch from an earlier
// dispatch could overwrite the freshly-rendered timeline from a newer
// dispatch, making posts visibly disappear "sometimes".
let renderVersion = 0;

function emptyTimeline(loggedIn) {
  return (
    '<div class="stub">' +
      '<h2 class="stub__title">' + t('home.empty.title') + '</h2>' +
      '<p class="stub__sub">' +
        (loggedIn ? t('home.empty.signed_in') : t('home.empty.guest')) +
      '</p>' +
    '</div>'
  );
}

function loadingTimeline() {
  return '<div class="stub" id="timeline-loading"><p class="stub__sub">' + t('home.loading') + '</p></div>';
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

export function renderHome() {
  renderVersion++;
  return [
    '<div class="timeline__head">',
      '<a class="tab is-active" href="/">' + t('home.tab.foryou') + '</a>',
      '<a class="tab" href="/">' + t('home.tab.following') + '</a>',
      '<a class="tab" href="/">' + t('home.tab.spots') + '</a>',
    '</div>',
    renderIdeaForm({ user: currentUser() }),
    '<div id="timeline-list">',
      loadingTimeline(),
    '</div>',
  ].join('');
}

// Async fetch of the global timeline; replaces the loading skeleton with
// the rendered posts (or the empty state). Like counts come in a second
// hydration pass so the posts paint immediately. Guards every DOM write
// against `renderVersion` so stale fetches don't clobber a fresh render.
export async function hydrateHome() {
  const myVersion = renderVersion;
  const list = document.getElementById('timeline-list');
  if (!list) return;

  let posts;
  try {
    posts = await allPosts();
  } catch (err) {
    if (myVersion !== renderVersion) return;
    console.error('hydrateHome: allPosts failed', err);
    list.innerHTML = errorTimeline(err.message || '通信エラー');
    return;
  }
  if (myVersion !== renderVersion) return;

  if (!posts.length) {
    list.innerHTML = emptyTimeline(!!currentUser());
    return;
  }
  list.innerHTML = posts.map(renderPost).join('');

  try {
    await hydratePostLikes(posts.map(p => p.id));
  } catch (err) {
    console.warn('hydratePostLikes failed', err);
    // Non-fatal — posts already painted with stale (zero) counts.
    return;
  }
  if (myVersion !== renderVersion) return;
  // Re-render to pick up the freshly cached like counts / is-liked state.
  list.innerHTML = posts.map(renderPost).join('');
}
