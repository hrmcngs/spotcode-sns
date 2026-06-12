import { renderIdeaForm } from '../idea-post.js';
import { allPosts }       from '../data.js';
import { renderPost }     from '../post.js';
import { currentUser }    from '../auth.js';
import { hydratePostLikes } from '../interactions.js';

function emptyTimeline(loggedIn) {
  return (
    '<div class="stub">' +
      '<h2 class="stub__title">タイムラインはまだ空です</h2>' +
      '<p class="stub__sub">' +
        (loggedIn
          ? '上のコンポーザーから最初のアイデアを投稿してみましょう。'
          : 'サインインして最初の一歩を投稿してみましょう。') +
      '</p>' +
    '</div>'
  );
}

function loadingTimeline() {
  return '<div class="stub" id="timeline-loading"><p class="stub__sub">タイムラインを読み込み中…</p></div>';
}

export function renderHome() {
  return [
    '<div class="timeline__head">',
      '<a class="tab is-active" href="/">For you</a>',
      '<a class="tab" href="/">Following</a>',
      '<a class="tab" href="/">Spots</a>',
    '</div>',
    renderIdeaForm({ user: currentUser() }),
    '<div id="timeline-list">',
      loadingTimeline(),
    '</div>',
  ].join('');
}

// Async fetch of the global timeline; replaces the loading skeleton with
// the rendered posts (or the empty state). Like counts come in a second
// hydration pass so the posts paint immediately.
export async function hydrateHome() {
  const list = document.getElementById('timeline-list');
  if (!list) return;
  const posts = await allPosts();
  if (!posts.length) {
    list.innerHTML = emptyTimeline(!!currentUser());
    return;
  }
  list.innerHTML = posts.map(renderPost).join('');
  await hydratePostLikes(posts.map(p => p.id));
  // Re-render to pick up the freshly cached like counts / is-liked state.
  list.innerHTML = posts.map(renderPost).join('');
}
