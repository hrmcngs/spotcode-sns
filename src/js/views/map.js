// Full-bleed map view — plots a pin for every post that has a spot.
// The pin position and the building it's stuck on are always visible
// (so you can see "lots of ideas were posted here"), but the post body
// is gated by location: it only appears in the popup when the viewer
// is within geo-gate's radius of the pin. Otherwise the popup explains
// "come within Xm to read this idea".

import { loadMaps } from '../gmap.js';
import { postsWithSpots, cachedPosts } from '../data.js';
import { t }        from '../i18n.js';
import { icon }     from '../icons.js';
import { getMyLocation, isNearSpotSync, getRadius, permissionDenied,
         cachedLocation, cachedApproxLocation, getApproxLocationViaIP } from '../geo-gate.js';
import { currentUser } from '../auth.js';
import { isDevMode } from '../dev-mode.js';
import { timelineTabs } from './timeline-tabs.js';
import { withTimeout } from '../net-utils.js';

let renderVersion = 0;
let mapInst = null;
let markerLayer = null;

const TOKYO = { lat: 35.681236, lng: 139.767125 };

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

export function renderMap(city) {
  renderVersion++;
  const title = city ? escape(city) : t('map.title');
  return (
    // Same For you / Following / Spots tab bar as Home so the user
    // can jump back without a sidebar / hamburger detour.
    timelineTabs('spots') +
    '<div class="map-head">' +
      '<div class="map-head__icon">' + icon('pin', { size: 24 }) + '</div>' +
      '<div>' +
        '<h2 class="map-head__title">' + title + '</h2>' +
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
  const canRead = isMine || isDevMode() || near === true;

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

export async function hydrateMap(city, focus = null) {
  const myVersion = renderVersion;
  const canvas = document.getElementById('map-canvas');
  const status = document.getElementById('map-status');
  if (!canvas) return;

  // Free any prior Leaflet instance BEFORE we potentially recreate
  // one. Otherwise a return-visit to /spots leaves the old map bound
  // to a detached #map-canvas and Leaflet quietly leaks tile
  // requests + DOM handlers on every hydrate.
  if (mapInst) { try { mapInst.remove(); } catch {} mapInst = null; }
  markerLayer = null;

  // Kick off all three network calls in parallel — Leaflet load,
  // posts, and (only when we don't already have a real GPS fix)
  // an IP-based coarse location. The previous serial `await` chain
  // stacked ~1-2s of Supabase + ~500ms of ipwho.is on top of the
  // Leaflet CDN round-trip; parallelising them cuts total wall-clock
  // to the slowest single leg.
  const cachedForPaint = cachedPosts('spots') || [];
  const postsPromise = withTimeout(postsWithSpots({ limit: 120 }), 10000, '地図投稿取得').catch((err) => {
    console.warn('hydrateMap: postsWithSpots failed, using cache', err);
    return cachedForPaint;
  });
  const herePromise = withTimeout(getMyLocation(), 8000, '現在地取得').catch(() => null);
  // Coarse IP fix only when the exact fix isn't already sitting in
  // the module-level cache. Fires in parallel so it's ready by the
  // time we know `here` is null.
  const approxPromise = cachedLocation()
    ? Promise.resolve(null)
    : withTimeout(getApproxLocationViaIP(), 6000, '推定位置取得').catch(() => null);

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

  const [posts, here, approxIp] = await Promise.all([
    postsPromise, herePromise, approxPromise,
  ]);
  if (myVersion !== renderVersion) return;

  // `postsWithSpots` already filters server-side (`spot is not null`)
  // so this defensive re-filter only catches lat/lng shape drift.
  const allSpotted = (posts || []).filter(p => p?.spot?.lat != null && p?.spot?.lng != null);
  // City-scoped view (e.g. /spots/世田谷区 from the Trending card): drop
  // pins outside the city so the canvas only shows that 市区町村's ideas
  // and we can fitBounds onto them. Falls back to the unfiltered list
  // if the city has no spots yet (avoids an empty Tokyo-default fly-in).
  const cityFiltered = city
    ? allSpotted.filter(p => p?.spot?.addressDetails?.city === city)
    : null;
  const spotted = (cityFiltered && cityFiltered.length) ? cityFiltered : allSpotted;

  // Center: in city mode prefer the city's spots (fitBounds below
  // handles real positioning); otherwise prefer the exact GPS fix,
  // then IP approx, then the first spotted post, then a Tokyo default.
  const hasFocus = focus && Number.isFinite(focus.lat) && Number.isFinite(focus.lng);
  const center = hasFocus ? [focus.lat, focus.lng]
                : (cityFiltered && cityFiltered.length)
                ? [cityFiltered[0].spot.lat, cityFiltered[0].spot.lng]
                : here       ? [here.lat, here.lng]
                : approxIp  ? [approxIp.lat, approxIp.lng]
                : spotted[0] ? [spotted[0].spot.lat, spotted[0].spot.lng]
                : [TOKYO.lat, TOKYO.lng];

  mapInst = L.map(canvas, { zoomControl: true }).setView(center, hasFocus ? 17 : (here ? 15 : 13));

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
  const gsiStandard = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', {
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>',
    maxZoom: 18,
    maxNativeZoom: 18,
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
    { '地図 (OSM)': osm, '地図 (国土地理院)': gsiStandard, '航空写真 (日本)': gsiAerial, '航空写真 (世界)': esriAerial },
    null,
    { position: 'topright', collapsed: true }
  ).addTo(mapInst);

  // Some Japanese mobile carriers/proxies intermittently fail OSM tile
  // requests even though the app and Supabase are reachable. After three
  // failed tiles, automatically switch to GSI's Japan-wide standard map.
  // The layer control still lets the user switch back manually.
  let osmTileErrors = 0;
  let usingFallbackTiles = false;
  osm.on('tileerror', () => {
    osmTileErrors++;
    if (usingFallbackTiles || osmTileErrors < 3 || !mapInst) return;
    usingFallbackTiles = true;
    try { mapInst.removeLayer(osm); } catch {}
    gsiStandard.addTo(mapInst);
    if (status) status.textContent = 'モバイル回線向けの代替地図に切り替えました';
  });

  if (here) {
    // User position + unlock-radius ring. fitBounds() to the ring so
    // its edge touches the canvas edge regardless of viewport size —
    // that visually anchors the "you have to walk inside the blue
    // circle to read the body" rule the geo-gate enforces.
    // In city-scoped mode we still draw the ring (the gate is still
    // active) but defer the framing to the city-pins fitBounds below.
    const ring = L.circle([here.lat, here.lng], {
      radius: getRadius(), color: '#1d9bf0', weight: 1, fillOpacity: 0.08,
    }).addTo(mapInst);
    L.circleMarker([here.lat, here.lng], { radius: 6, color: '#1d9bf0', fillColor: '#1d9bf0', fillOpacity: 1 }).addTo(mapInst);
    if (!(cityFiltered && cityFiltered.length)) {
      mapInst.fitBounds(ring.getBounds(), { padding: [4, 4], maxZoom: 19, animate: false });
    }
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
  let focusedMarker = null;
  for (const p of spotted) {
    const m = L.circleMarker([p.spot.lat, p.spot.lng], {
      radius: 7, weight: 2, color: '#f91880', fillColor: '#f91880', fillOpacity: 0.85,
    });
    m.bindPopup(() => pinPopupHtml(p), { className: 'map-popup' });
    markerLayer.addLayer(m);
    if (hasFocus && (
      (focus.postId && p.id === focus.postId) ||
      (!focus.postId && Number(p.spot.lat) === focus.lat && Number(p.spot.lng) === focus.lng)
    )) focusedMarker = m;
  }

  // A location link from a post should land on that exact pin rather
  // than being reframed around the user's current-location radius.
  if (hasFocus) {
    mapInst.setView([focus.lat, focus.lng], 17, { animate: false });
    if (focusedMarker) focusedMarker.openPopup();
  }

  // City-scoped framing: fit the canvas to just this 市区町村's pins so
  // the user lands looking at the area, not at their own location or
  // the Tokyo default. Single pin → recenter at a sensible zoom (one
  // point has no bounds).
  if (!hasFocus && cityFiltered && cityFiltered.length) {
    if (cityFiltered.length === 1) {
      mapInst.setView([cityFiltered[0].spot.lat, cityFiltered[0].spot.lng], 14);
    } else {
      const bounds = L.latLngBounds(cityFiltered.map(p => [p.spot.lat, p.spot.lng]));
      mapInst.fitBounds(bounds, { padding: [32, 32], maxZoom: 16, animate: false });
    }
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

  // Leaflet measures container at init time and only requests tiles for
  // the bounds it sees then. On mobile (iOS Safari especially) the
  // viewport keeps changing while the URL bar collapses, so the
  // measurement at init can be 0×0 and the user ends up with a blank
  // canvas. Belt-and-suspenders:
  //   1. Re-measure on a staircase of timeouts so we catch the layout
  //      whenever it actually settles.
  //   2. Re-measure whenever the canvas itself changes size (toolbar
  //      collapse, orientation change, soft-keyboard).
  const recompute = () => {
    if (!mapInst) return;
    mapInst.invalidateSize();
    // After a real resize, the city-mode fit might be off — re-frame.
    if (cityFiltered && cityFiltered.length > 1) {
      const bounds = L.latLngBounds(cityFiltered.map(p => [p.spot.lat, p.spot.lng]));
      mapInst.fitBounds(bounds, { padding: [32, 32], maxZoom: 16, animate: false });
    }
  };
  // Two size re-checks are enough: one right after paint (60ms) for
  // the initial-mount 0×0 case, one after the URL bar likely settled
  // (400ms). The old 4-step staircase kept firing after the map had
  // long since settled — extra work on a page already flagged as
  // "重い". ResizeObserver still catches genuine viewport changes
  // (orientation flip, keyboard).
  [60, 400].forEach(ms => setTimeout(recompute, ms));
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => mapInst && mapInst.invalidateSize());
    ro.observe(canvas);
  }
}
