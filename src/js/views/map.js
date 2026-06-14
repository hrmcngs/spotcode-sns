// Full-bleed map view — plots a pin for every post that has a spot.
// The pin position and the building it's stuck on are always visible
// (so you can see "lots of ideas were posted here"), but the post body
// is gated by location: it only appears in the popup when the viewer
// is within geo-gate's radius of the pin. Otherwise the popup explains
// "come within Xm to read this idea".

import { loadMaps } from '../gmap.js';
import { allPosts } from '../data.js';
import { t }        from '../i18n.js';
import { icon }     from '../icons.js';
import { getMyLocation, isNearSpotSync, getRadius, permissionDenied,
         cachedLocation } from '../geo-gate.js';
import { currentUser } from '../auth.js';

let renderVersion = 0;
let mapInst = null;
let markerLayer = null;

const TOKYO = { lat: 35.681236, lng: 139.767125 };

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

export function renderMap() {
  renderVersion++;
  return (
    '<div class="map-head">' +
      '<div class="map-head__icon">' + icon('pin', { size: 24 }) + '</div>' +
      '<div>' +
        '<h2 class="map-head__title">' + t('map.title') + '</h2>' +
        '<p class="map-head__sub" id="map-status">' + t('map.loading') + '</p>' +
      '</div>' +
    '</div>' +
    '<div id="map-canvas" class="map-canvas"></div>'
  );
}

function pinPopupHtml(post) {
  const building = post.spot?.label || post.spot?.addressDetails?.full || '';
  const author = post.author?.name || post.authorHandle || '';
  const handle = post.authorHandle || '';
  const near = isNearSpotSync(post.spot.lat, post.spot.lng);
  const me = currentUser();
  const isMine = me && me.handle === handle;
  const canRead = isMine || near === true;

  const headerHtml =
    '<div class="map-popup__head">' +
      '<strong>' + escape(building || t('map.unknown_building')) + '</strong>' +
      '<div class="map-popup__author">@' + escape(handle) + '</div>' +
    '</div>';

  if (canRead) {
    return headerHtml +
      '<div class="map-popup__body">' + escape(post.body || '') + '</div>';
  }
  return headerHtml +
    '<div class="map-popup__locked">' +
      t('map.locked', { r: getRadius() }) +
    '</div>';
}

export async function hydrateMap() {
  const myVersion = renderVersion;
  const canvas = document.getElementById('map-canvas');
  const status = document.getElementById('map-status');
  if (!canvas) return;

  // Split the three awaits so a partial failure doesn't break the
  // whole map. On mobile, ANY of these can fail individually:
  //   - loadMaps()      → CDN slow / WKWebView CSP / offline
  //   - allPosts()      → Supabase RLS / schema cache miss
  //   - getMyLocation() → already resolves null on denial, but
  //                       defend in depth in case that changes
  // We only NEED Leaflet to render anything; posts and location are
  // both nice-to-have and degrade to empty.
  let L;
  try {
    L = await loadMaps();
  } catch (err) {
    if (myVersion !== renderVersion) return;
    if (status) status.textContent = t('map.error') + ': Leaflet ' + (err.message || '');
    console.error('hydrateMap: loadMaps failed', err);
    return;
  }
  if (myVersion !== renderVersion) return;

  const posts = await allPosts({ limit: 500 }).catch((err) => {
    console.warn('hydrateMap: allPosts failed, rendering empty map', err);
    return [];
  });
  const here = await getMyLocation().catch(() => null);
  if (myVersion !== renderVersion) return;

  const spotted = (posts || []).filter(p => p?.spot?.lat != null && p?.spot?.lng != null);

  // Center on user's location if we have it, else on the first spot,
  // else default to Tokyo.
  const center = here ? [here.lat, here.lng]
                : spotted[0] ? [spotted[0].spot.lat, spotted[0].spot.lng]
                : [TOKYO.lat, TOKYO.lng];

  mapInst = L.map(canvas, { zoomControl: true }).setView(center, here ? 15 : 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(mapInst);

  if (here) {
    L.circle(center, { radius: getRadius(), color: '#1d9bf0', weight: 1, fillOpacity: 0.08 }).addTo(mapInst);
    L.circleMarker(center, { radius: 6, color: '#1d9bf0', fillColor: '#1d9bf0', fillOpacity: 1 }).addTo(mapInst);
  }

  markerLayer = L.layerGroup().addTo(mapInst);
  for (const p of spotted) {
    const m = L.marker([p.spot.lat, p.spot.lng]);
    m.bindPopup(pinPopupHtml(p), { className: 'map-popup' });
    markerLayer.addLayer(m);
  }

  if (status) {
    if (cachedLocation()) {
      status.textContent = t('map.subtitle_with_loc', { n: spotted.length, r: getRadius() });
    } else if (permissionDenied()) {
      status.textContent = t('map.subtitle_denied', { n: spotted.length });
    } else {
      status.textContent = t('map.subtitle_no_loc', { n: spotted.length });
    }
  }

  // Leaflet measures container at init time; recompute once visible so
  // tiles cover the full area on first paint.
  setTimeout(() => mapInst && mapInst.invalidateSize(), 60);
}
