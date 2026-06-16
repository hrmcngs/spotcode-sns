// Lazy loader for Leaflet (https://leafletjs.com). Free, no API key,
// no account required, no age restriction — works for any user on
// open OpenStreetMap tiles.
//
// The module is still named gmap.js for historical reasons; importers
// just need a `loadMaps()` promise that resolves with the map library.

const LEAFLET_VERSION = '1.9.4';
// Prefer the locally-bundled copy of Leaflet over the unpkg CDN —
// works offline (especially in the Electron `file://` build where
// cross-origin script loads from a CDN can be slow or blocked by
// the embedded Chromium's security policy) and removes the network
// round trip on first map open.
//
// `import.meta.url` resolves to `…/js/gmap.js`, so going up one
// segment lands at `…/lib/leaflet/…`. That works in every host
// (http GH Pages, file:// Electron, capacitor://) without
// having to know `window.__BASE__`.
const LIB_BASE = new URL('../lib/leaflet/', import.meta.url).href;
const LEAFLET_CSS = LIB_BASE + 'leaflet.css';
const LEAFLET_JS  = LIB_BASE + 'leaflet.js';
const LEAFLET_CSS_FALLBACK = 'https://unpkg.com/leaflet@' + LEAFLET_VERSION + '/dist/leaflet.css';
const LEAFLET_JS_FALLBACK  = 'https://unpkg.com/leaflet@' + LEAFLET_VERSION + '/dist/leaflet.js';

let leafletPromise = null;

export function isReady() {
  return !!window.L;
}

// Try the local bundled copy first, then the unpkg CDN if local
// somehow 404s (e.g. dev server serving a partial tree). Promise-
// based so the caller can `await loadMaps()` either way.
//
// `timeoutMs` guards against the script load stalling silently on
// mobile networks — without it, a half-fetched leaflet.js would
// leave `await loadMaps()` hanging forever and /spots would sit on
// "マップを読み込み中..." with a blank canvas.
function injectScript(src, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.leaflet = '1';
    let timer = setTimeout(() => {
      script.remove();
      reject(new Error('TIMEOUT'));
    }, timeoutMs);
    script.onload  = () => { clearTimeout(timer); window.L ? resolve(window.L) : reject(new Error('LOAD_FAILED')); };
    script.onerror = () => { clearTimeout(timer); reject(new Error('SCRIPT_ERROR')); };
    document.head.appendChild(script);
  });
}

export function loadMaps() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;

  leafletPromise = (async () => {
    if (!document.querySelector('link[data-leaflet]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = LEAFLET_CSS;
      link.dataset.leaflet = '1';
      document.head.appendChild(link);
    }
    try {
      return await injectScript(LEAFLET_JS, 8000);
    } catch (err) {
      console.warn('loadMaps: local Leaflet failed (' + err.message + '), falling back to CDN');
      // Remove the failed script tag so the next try can attach a new one.
      document.querySelectorAll('script[data-leaflet]').forEach(s => s.remove());
      // Also force-load the CDN CSS in case the local CSS hung too.
      if (!document.querySelector('link[data-leaflet-fallback]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = LEAFLET_CSS_FALLBACK;
        link.dataset.leafletFallback = '1';
        document.head.appendChild(link);
      }
      try {
        return await injectScript(LEAFLET_JS_FALLBACK, 12000);
      } catch (err2) {
        leafletPromise = null;
        throw err2;
      }
    }
  })();
  return leafletPromise;
}

// Reverse geocoding via OpenStreetMap's Nominatim service. Free, no key.
// Usage policy: keep request volume low, attribute OpenStreetMap somewhere
// in the UI (the © OpenStreetMap line on the map tiles satisfies that).
// `zoom=18` is the most detailed level (building / address). Extra tags
// and namedetails give us better odds of getting a building name.
export async function reverseGeocode(lat, lng) {
  const u = new URL('https://nominatim.openstreetmap.org/reverse');
  u.searchParams.set('format', 'jsonv2');
  u.searchParams.set('lat', String(lat));
  u.searchParams.set('lon', String(lng));
  u.searchParams.set('zoom', '18');
  u.searchParams.set('addressdetails', '1');
  u.searchParams.set('namedetails', '1');
  u.searchParams.set('extratags', '1');
  u.searchParams.set('accept-language', 'ja');
  const r = await fetch(u.toString(), { headers: { 'Accept': 'application/json' } });
  if (!r.ok) throw new Error('NOMINATIM_' + r.status);
  return r.json();
}

// Reverse geocoding via 国土地理院 (GSI). Free, no key, no rate-limit
// hassle, and consistently returns the Japanese 大字・町丁目 name
// (e.g. "神宮前六丁目") even when Nominatim only knows the broader ward.
// Returns null if outside Japan or no result.
export async function reverseGeocodeGSI(lat, lng) {
  const u = new URL('https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress');
  u.searchParams.set('lat', String(lat));
  u.searchParams.set('lon', String(lng));
  let r;
  try { r = await fetch(u.toString(), { headers: { 'Accept': 'application/json' } }); }
  catch { return null; }
  if (!r.ok) return null;
  let j;
  try { j = await r.json(); } catch { return null; }
  const res = j && j.results;
  if (!res || !res.lv01Nm) return null;
  return {
    muniCd: res.muniCd || '',
    chomeName: String(res.lv01Nm),  // e.g. "神宮前六丁目"
  };
}

// Pick a building / venue name from a Nominatim response.
export function pickBuildingName(data) {
  if (!data) return '';
  if (data.name && data.name.trim()) return data.name;
  if (data.namedetails?.name) return data.namedetails.name;
  const a = data.address || {};
  return (
    a.amenity || a.building || a.shop || a.attraction ||
    a.tourism || a.office  || a.leisure || a.aeroway ||
    a.public_transport || ''
  );
}

// Format a Japan-style postal address from a Nominatim response, optionally
// enriched with a GSI reverse-geocode result. GSI consistently knows the
// 大字・町丁目 part (e.g. "神宮前六丁目") that Nominatim often omits.
//
// Returns { full, postcode, prefecture, city, ward, chome, road,
//           houseNumber, missingHouseNumber }.
export function formatJapanAddress(data, gsi) {
  const a = (data && data.address) || {};
  const prefecture = a.province || a.state || '';
  const city       = a.city || a.town || a.village || a.municipality || '';
  // Ward / 大字 / neighbourhood — Nominatim distributes Japanese addresses
  // across several fields depending on the area.
  const wardRaw = [a.city_district, a.suburb, a.neighbourhood, a.quarter, a.hamlet]
    .filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join('');
  const road        = a.road || '';
  const houseNumber = a.house_number || '';
  const postcode    = a.postcode || '';

  // Prefer GSI's chōme name if it extends what we already have. e.g. when
  // Nominatim only gave "渋谷区" but GSI returned "神宮前六丁目", we want
  // both — ward stays "渋谷区", chome becomes "神宮前六丁目".
  let ward  = wardRaw;
  let chome = '';
  const gsiChome = gsi && gsi.chomeName;
  if (gsiChome) {
    if (!ward || !gsiChome.startsWith(ward)) {
      chome = gsiChome;
    } else {
      // GSI is already prefixed with the ward Nominatim gave us; trim it
      // so we don't render "神宮前神宮前六丁目".
      chome = gsiChome.slice(ward.length);
    }
  }

  const body = [prefecture, city, ward, chome, road, houseNumber].filter(Boolean).join('');
  const full = postcode
    ? '〒' + postcode + ' ' + body
    : body;

  return {
    full: full.trim() || (data?.display_name || ''),
    postcode, prefecture, city, ward, chome, road, houseNumber,
    missingHouseNumber: !houseNumber,
  };
}
