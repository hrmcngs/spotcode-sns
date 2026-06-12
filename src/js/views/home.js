import { renderIdeaForm } from '../idea-post.js';
import { allPosts }       from '../data.js';
import { renderPost }     from '../post.js';
import { currentUser }    from '../auth.js';

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

export function renderHome() {
  const me = currentUser();
  const posts = allPosts();
  return [
    '<div class="timeline__head">',
      '<a class="tab is-active" href="/">For you</a>',
      '<a class="tab" href="/">Following</a>',
      '<a class="tab" href="/">Spots</a>',
    '</div>',
    renderIdeaForm({ user: me }),
    posts.length ? posts.map(renderPost).join('') : emptyTimeline(!!me),
  ].join('');
}
