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
         cachedLocation, getApproxLocationViaIP } from '../geo-gate.js';
import { currentUser } from '../auth.js';
import { timelineTabs } from './timeline-tabs.js';

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
    // Same For you / Following / Spots tab bar as Home so the user
    // can jump back without a sidebar / hamburger detour.
    timelineTabs('spots') +
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

  // 500 was overkill — for a small SNS there's no point shoving 500
  // markers into the canvas, and the heavier Supabase round trip was
  // the single biggest contributor to "/spots feels slow". 200 still
  // covers every realistic case and shaves load time noticeably.
  const posts = await allPosts({ limit: 200 }).catch((err) => {
    console.warn('hydrateMap: allPosts failed, rendering empty map', err);
    return [];
  });
  // EXACT location via browser geolocation — used both for centering
  // AND for the unlock-ring + "you are here" pin. In Electron under
  // file:// (and any other context without a geolocation permission
  // UI) this resolves to null.
  const here = await getMyLocation().catch(() => null);
  // APPROXIMATE location via IP geolocation — used ONLY for centering
  // when we couldn't get an exact fix. Accuracy is city-level so it
  // can't drive the 100m unlock gate, but it's enough to open the
  // map near the viewer instead of defaulting to Tokyo.
  const approxIp = here ? null : await getApproxLocationViaIP().catch(() => null);
  if (myVersion !== renderVersion) return;

  const spotted = (posts || []).filter(p => p?.spot?.lat != null && p?.spot?.lng != null);

  // Center: prefer the exact GPS fix, then IP approx, then the first
  // spotted post, then a Tokyo default.
  const center = here       ? [here.lat, here.lng]
                : approxIp  ? [approxIp.lat, approxIp.lng]
                : spotted[0] ? [spotted[0].spot.lat, spotted[0].spot.lng]
                : [TOKYO.lat, TOKYO.lng];

  mapInst = L.map(canvas, { zoomControl: true }).setView(center, here ? 15 : 13);

  // ---- Base layers ----
  // Default: OSM standard map. Two aerial options behind a layer
  // switcher in the top-right corner: GSI シームレス空中写真 (very
  // high resolution but Japan only) and Esri World Imagery (lower
  // res but worldwide). All three are free and key-less; attribution
  // ribbon goes in the bottom-right per each provider's policy.
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    maxZoom: 19,
  });
  const gsiAerial = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg', {
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院 シームレス空中写真</a>',
    maxZoom: 18,
    maxNativeZoom: 18,
  });
  const esriAerial = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    maxZoom: 19,
  });
  osm.addTo(mapInst);
  L.control.layers(
    { '地図': osm, '航空写真 (日本)': gsiAerial, '航空写真 (世界)': esriAerial },
    null,
    { position: 'topright', collapsed: true }
  ).addTo(mapInst);

  if (here) {
    // User position + unlock-radius ring. fitBounds() to the ring so
    // its edge touches the canvas edge regardless of viewport size —
    // that visually anchors the "you have to walk inside the blue
    // circle to read the body" rule the geo-gate enforces.
    const ring = L.circle(center, {
      radius: getRadius(), color: '#1d9bf0', weight: 1, fillOpacity: 0.08,
    }).addTo(mapInst);
    L.circleMarker(center, { radius: 6, color: '#1d9bf0', fillColor: '#1d9bf0', fillOpacity: 1 }).addTo(mapInst);
    mapInst.fitBounds(ring.getBounds(), { padding: [4, 4], maxZoom: 19, animate: false });
  }

  // Use circleMarker instead of marker:
  //   - pure SVG, no per-pin image asset to lay out
  //   - cheaper hit-testing
  //   - scales with zoom (subjective improvement on cluttered areas)
  // And bind the popup LAZILY: building 200 popup HTML strings up front
  // (each one runs escape() over the body, calls isNearSpotSync, formats
  // the locked banner) burned more time than the marker creation itself
  // and was thrown away for every pin the user never clicked. Defer it
  // to the first popupopen event per marker.
  markerLayer = L.layerGroup().addTo(mapInst);
  for (const p of spotted) {
    const m = L.circleMarker([p.spot.lat, p.spot.lng], {
      radius: 7, weight: 2, color: '#f91880', fillColor: '#f91880', fillOpacity: 0.85,
    });
    m.bindPopup(() => pinPopupHtml(p), { className: 'map-popup' });
    markerLayer.addLayer(m);
  }

  if (status) {
    if (cachedLocation()) {
      status.textContent = t('map.subtitle_with_loc', { n: spotted.length, r: getRadius() });
    } else if (approxIp) {
      // IP-only fix — show the city name so the user knows the
      // centering is approximate and that the unlock gate is inactive.
      const where = approxIp.city || approxIp.country || '推定位置';
      status.textContent = spotted.length + ' 件のピン · 地図はおおよそ ' + where + ' 中心 (IP 推定)';
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
