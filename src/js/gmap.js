// Lazy loader for Leaflet (https://leafletjs.com). Free, no API key,
// no account required, no age restriction — works for any user on
// open OpenStreetMap tiles.
//
// The module is still named gmap.js for historical reasons; importers
// just need a `loadMaps()` promise that resolves with the map library.

const LEAFLET_VERSION = '1.9.4';
const LEAFLET_CSS = 'https://unpkg.com/leaflet@' + LEAFLET_VERSION + '/dist/leaflet.css';
const LEAFLET_JS  = 'https://unpkg.com/leaflet@' + LEAFLET_VERSION + '/dist/leaflet.js';

let leafletPromise = null;

export function isReady() {
  return !!window.L;
}

export function loadMaps() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;

  leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-leaflet]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = LEAFLET_CSS;
      link.dataset.leaflet = '1';
      document.head.appendChild(link);
    }
    const script = document.createElement('script');
    script.src = LEAFLET_JS;
    script.async = true;
    script.defer = true;
    script.dataset.leaflet = '1';
    script.onload  = () => window.L ? resolve(window.L) : reject(new Error('LOAD_FAILED'));
    script.onerror = () => {
      leafletPromise = null;
      reject(new Error('SCRIPT_ERROR'));
    };
    document.head.appendChild(script);
  });
  return leafletPromise;
}

// Reverse geocoding via OpenStreetMap's Nominatim service. Free, no key.
// Usage policy: keep request volume low, attribute OpenStreetMap somewhere
// in the UI (the © OpenStreetMap line on the map tiles satisfies that).
export async function reverseGeocode(lat, lng) {
  const u = new URL('https://nominatim.openstreetmap.org/reverse');
  u.searchParams.set('format', 'jsonv2');
  u.searchParams.set('lat', String(lat));
  u.searchParams.set('lon', String(lng));
  u.searchParams.set('zoom', '18');
  u.searchParams.set('addressdetails', '1');
  u.searchParams.set('accept-language', 'ja');
  const r = await fetch(u.toString(), { headers: { 'Accept': 'application/json' } });
  if (!r.ok) throw new Error('NOMINATIM_' + r.status);
  return r.json();
}

// Pick a building / venue name from a Nominatim response.
export function pickBuildingName(data) {
  if (!data) return '';
  if (data.name && data.name.trim()) return data.name;
  const a = data.address || {};
  return (
    a.amenity || a.building || a.shop || a.attraction ||
    a.tourism || a.office  || a.leisure || a.aeroway ||
    a.public_transport || ''
  );
}
