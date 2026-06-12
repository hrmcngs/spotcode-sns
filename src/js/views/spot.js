// City-scoped timeline. Reached from the right-rail "Trending spots"
// card; shows every post whose spot.addressDetails.city matches.

import { postsByCity }       from '../data.js';
import { renderPost }        from '../post.js';
import { hydratePostLikes }  from '../interactions.js';
import { icon }              from '../icons.js';

let renderVersion = 0;

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

export function renderSpot(city) {
  renderVersion++;
  const safe = escape(city);
  return (
    '<div class="spot-head">' +
      '<div class="spot-head__icon">' + icon('pin', { size: 28 }) + '</div>' +
      '<h2 class="spot-head__title">' + safe + '</h2>' +
      '<p class="spot-head__sub">この市区町村で生まれたアイデア</p>' +
    '</div>' +
    '<div class="timeline__head">' +
      '<a class="tab is-active" href="#">Posts</a>' +
    '</div>' +
    '<div id="spot-posts">' +
      '<div class="stub"><p class="stub__sub">投稿を読み込み中…</p></div>' +
    '</div>'
  );
}

export async function hydrateSpot(city) {
  const myVersion = renderVersion;
  const list = document.getElementById('spot-posts');
  if (!list) return;
  let posts;
  try { posts = await postsByCity(city); }
  catch (err) {
    if (myVersion !== renderVersion) return;
    console.error('hydrateSpot', err);
    list.innerHTML = '<div class="stub"><p class="stub__sub">投稿の取得に失敗しました: ' + escape(err.message || '') + '</p></div>';
    return;
  }
  if (myVersion !== renderVersion) return;
  if (!posts.length) {
    list.innerHTML = '<div class="stub"><p class="stub__sub">まだここからの投稿はありません。</p><a class="back-home" href="/">← Back to home</a></div>';
    return;
  }
  list.innerHTML = posts.map(renderPost).join('');
  try { await hydratePostLikes(posts.map(p => p.id)); }
  catch (err) { console.warn('hydratePostLikes (spot)', err); return; }
  if (myVersion !== renderVersion) return;
  list.innerHTML = posts.map(renderPost).join('');
}
