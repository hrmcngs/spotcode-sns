// City-scoped timeline. Reached from the right-rail "Trending spots"
// card; shows every post whose spot.addressDetails.city matches.

import { postsByCity }       from '../data.js';
import { renderPost }        from '../post.js';
import { hydratePostLikes }  from '../interactions.js';
import { icon }              from '../icons.js';
import { t }                 from '../i18n.js';
import { currentUser }       from '../auth.js';
import { getMyLocation, filterPostsByLocation, permissionDenied,
         cachedLocation, getRadius } from '../geo-gate.js';

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
      '<p class="spot-head__sub">' + t('spot.subtitle') + '</p>' +
    '</div>' +
    '<div class="timeline__head">' +
      '<a class="tab is-active" href="#">' + t('profile.tab.posts') + '</a>' +
    '</div>' +
    '<div id="spot-posts">' +
      '<div class="stub"><p class="stub__sub">' + t('spot.loading') + '</p></div>' +
    '</div>'
  );
}

function geoBanner() {
  if (cachedLocation()) {
    return '<div class="geo-banner geo-banner--on">' +
      t('geo.showing_nearby', { r: getRadius() }) +
    '</div>';
  }
  if (permissionDenied()) {
    return '<div class="geo-banner geo-banner--off">' + t('geo.denied') + '</div>';
  }
  return '<div class="geo-banner geo-banner--off">' + t('geo.waiting') + '</div>';
}

export async function hydrateSpot(city) {
  const myVersion = renderVersion;
  const list = document.getElementById('spot-posts');
  if (!list) return;
  // Geolocation in parallel with the fetch so the gate is primed when
  // we hit filterPostsByLocation below.
  const [posts] = await Promise.all([
    postsByCity(city).catch((err) => err),
    getMyLocation(),
  ]);
  if (myVersion !== renderVersion) return;
  if (posts instanceof Error) {
    console.error('hydrateSpot', posts);
    list.innerHTML = '<div class="stub"><p class="stub__sub">' + escape(posts.message || '') + '</p></div>';
    return;
  }

  const me = currentUser();
  const gated = filterPostsByLocation(posts, me?.handle);
  const banner = geoBanner();

  if (!gated.length) {
    const sub = posts.length
      ? t('geo.too_far', { r: getRadius() })   // posts exist but you're not nearby
      : t('spot.empty');                       // genuinely no posts here
    list.innerHTML = banner + '<div class="stub"><p class="stub__sub">' + sub + '</p><a class="back-home" href="/">' + t('profile.back') + '</a></div>';
    return;
  }
  list.innerHTML = banner + gated.map(renderPost).join('');
  try { await hydratePostLikes(gated.map(p => p.id)); }
  catch (err) { console.warn('hydratePostLikes (spot)', err); return; }
  if (myVersion !== renderVersion) return;
  list.innerHTML = banner + gated.map(renderPost).join('');
}
