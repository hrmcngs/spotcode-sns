// Tiny service worker so spotcode-sns is installable as a PWA on
// iOS / Android home screens and keeps working offline once visited.
//
// Strategy:
//   - precache the app shell on install
//   - cache-first for same-origin GET requests
//   - never intercept POSTs or cross-origin (Maps tiles, GitHub API, ...)
//   - bump CACHE when shipping a new version to nuke the old shell

const CACHE = 'spotcode-shell-v33';
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
  './js/ios-zoom.js',
  './js/body-scroll-lock.js',
  './js/drafts.js',
  './js/github-activity.js',
  './js/github-verify.js',
  './js/i18n.js',
  './js/geo-gate.js',
  './js/grass.js',
  './js/file-size-viz.js',
  './js/status-badges.js',
  './js/gh-link.js',
  './js/views/home.js',
  './js/views/profile.js',
  './js/views/stub.js',
  './js/views/settings.js',
  './js/views/spot.js',
  './js/views/map.js',
  './js/views/requests.js',
  './js/views/follow-list.js',
  './js/views/spot-picker.js',
  './js/views/post-detail.js',
  './js/views/post-analytics.js',
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

  // Spot / profile / handle paths are SPA routes — index.html serves them.
  // Returning a stale cached entry for /spot/<city> would otherwise pin
  // an old HTML snapshot that references files that no longer exist.
  const isAppRoute = req.mode === 'navigate' && req.destination === 'document';

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached && !isAppRoute) return cached;
      return fetch(req).then((res) => {
        // Opportunistically cache successful same-origin responses so
        // newly-touched paths become offline-available too.
        if (res && res.status === 200 && res.type === 'basic' && !isAppRoute) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => {
        // Only fall back to the cached index.html for actual document
        // navigations. Returning HTML when the browser asked for a JS
        // module or CSS file silently breaks the whole page (parser
        // chokes on the HTML, module never loads, no JS runs).
        if (isAppRoute) return caches.match('./index.html');
        return new Response('', { status: 504, statusText: 'offline' });
      });
    })
  );
});
