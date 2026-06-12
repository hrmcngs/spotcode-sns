import { renderIdeaForm } from '../idea-post.js';
import { allPosts }       from '../data.js';
import { renderPost }     from '../post.js';
import { currentUser }    from '../auth.js';

export function renderHome() {
  return [
    '<div class="timeline__head">',
      '<a class="tab is-active" href="/">For you</a>',
      '<a class="tab" href="/">Following</a>',
      '<a class="tab" href="/">Spots</a>',
    '</div>',
    renderIdeaForm({ spot: 'shibuya', user: currentUser() }),
    allPosts().map(renderPost).join(''),
  ].join('');
}
