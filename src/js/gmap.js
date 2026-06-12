// Lazy loader for the Google Maps JavaScript API.
// The key is held in localStorage so it never gets committed to the repo.

import { KEYS, read, write, remove } from './storage.js';

export function getApiKey() {
  return read(KEYS.gmapsKey, '') || '';
}

export function setApiKey(key) {
  const trimmed = String(key || '').trim();
  if (!trimmed) { remove(KEYS.gmapsKey); resetCache(); return; }
  write(KEYS.gmapsKey, trimmed);
  resetCache();
}

let mapsPromise = null;
function resetCache() {
  mapsPromise = null;
  // Drop any previously loaded script tag so the next load uses the new key.
  document.querySelectorAll('script[data-gmaps]').forEach(s => s.remove());
  delete window.google;
  delete window.__gmapsReady;
}

export function isReady() {
  return !!(window.google && window.google.maps);
}

export function loadMaps() {
  if (isReady()) return Promise.resolve(window.google.maps);
  if (mapsPromise) return mapsPromise;
  const key = getApiKey();
  if (!key) return Promise.reject(new Error('NO_KEY'));

  mapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const url = new URL('https://maps.googleapis.com/maps/api/js');
    url.searchParams.set('key', key);
    url.searchParams.set('v', 'weekly');
    url.searchParams.set('libraries', 'marker');
    url.searchParams.set('loading', 'async');
    url.searchParams.set('callback', '__gmapsReady');
    script.src = url.toString();
    script.async = true;
    script.defer = true;
    script.dataset.gmaps = '1';
    window.__gmapsReady = () => {
      if (window.google && window.google.maps) resolve(window.google.maps);
      else reject(new Error('LOAD_FAILED'));
    };
    script.onerror = () => {
      mapsPromise = null;
      reject(new Error('SCRIPT_ERROR'));
    };
    document.head.appendChild(script);
  });
  return mapsPromise;
}
