// Tiny service worker so spotcode-sns is installable as a PWA on
// iOS / Android home screens and keeps working offline once visited.
//
// Strategy:
//   - precache the app shell on install
//   - cache-first for same-origin GET requests
//   - never intercept POSTs or cross-origin (Maps tiles, GitHub API, ...)
//   - bump CACHE when shipping a new version to nuke the old shell

const CACHE = 'spotcode-shell-v14';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './favicon.svg',
  './css/style.css',
  './js/main.js',
  './js/router.js',
  './js/auth.js',
  './js/storage.js',
  './js/data.js',
  './js/post.js',
  './js/idea-post.js',
  './js/icons.js',
  './js/badges.js',
  './js/gmap.js',
  './js/interactions.js',
  './js/theme.js',
  './js/dev-mode.js',
  './js/jp-romaji.js',
  './js/i18n.js',
  './js/grass.js',
  './js/file-size-viz.js',
  './js/status-badges.js',
  './js/gh-link.js',
  './js/views/home.js',
  './js/views/profile.js',
  './js/views/stub.js',
  './js/views/settings.js',
  './js/views/spot.js',
  './js/views/follow-list.js',
  './js/views/spot-picker.js',
  './js/views/auth-modal.js',
  './js/views/edit-profile-modal.js',
  './js/views/report-modal.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // allSettled so a single missing file doesn't abort the whole install.
      Promise.allSettled(SHELL.map((u) => cache.add(u)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // Opportunistically cache successful same-origin responses so
        // newly-touched paths become offline-available too.
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
