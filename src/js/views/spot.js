// City-scoped timeline. Reached from the right-rail "Trending spots"
// card; shows every post whose spot.addressDetails.city matches.

import { postsByCity, hydrateQuotedPosts, cachedPosts } from '../data.js';
import { renderPost }        from '../post.js';
import { hydratePostLikes, hydrateRepostsMine, hydrateBookmarksMine } from '../interactions.js';
import { icon }              from '../icons.js';
import { t }                 from '../i18n.js';
import { renderTimelineSkeleton } from '../skeleton.js';

let renderVersion = 0;

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

export function renderSpot(city) {
  renderVersion++;
  const safe = escape(city);
  const cached = cachedPosts('city:' + city);
  const initial = (cached && cached.length)
    ? cached.map(renderPost).join('')
    : renderTimelineSkeleton(3);
  return (
    '<div class="spot-head">' +
      '<div class="spot-head__icon">' + icon('pin', { size: 28 }) + '</div>' +
      '<h2 class="spot-head__title">' + safe + '</h2>' +
      '<p class="spot-head__sub">' + t('spot.subtitle') + '</p>' +
    '</div>' +
    '<div class="timeline__head">' +
      '<a class="tab is-active" href="#">' + t('profile.tab.posts') + '</a>' +
    '</div>' +
    '<div id="spot-posts">' + initial + '</div>'
  );
}

// No geo-gate — this city-scoped view shows every post tagged with the
// given city, regardless of where the viewer is. The location-gated
// experience moved to the Map view (/spots).
export async function hydrateSpot(city) {
  const myVersion = renderVersion;
  const list = document.getElementById('spot-posts');
  if (!list) return;
  let posts;
  try { posts = await postsByCity(city); }
  catch (err) {
    if (myVersion !== renderVersion) return;
    console.error('hydrateSpot', err);
    list.innerHTML = '<div class="stub"><p class="stub__sub">' + escape(err.message || '') + '</p></div>';
    return;
  }
  if (myVersion !== renderVersion) return;
  if (!posts.length) {
    list.innerHTML = '<div class="stub"><p class="stub__sub">' + t('spot.empty') + '</p><a class="back-home" href="/">' + t('profile.back') + '</a></div>';
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
  } catch (err) { console.warn('hydrate batch (spot)', err); return; }
  if (myVersion !== renderVersion) return;
  list.innerHTML = posts.map(renderPost).join('');
}
