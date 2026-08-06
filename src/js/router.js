// Hybrid router: uses History API on http(s), hash routing on file:// (Electron)
// and capacitor:// (iOS Capacitor wrap). This lets the same code work as a
// static GH Pages site, a packaged Electron app, and a Capacitor-wrapped iOS
// app where the History API base path can't be derived reliably.

const HASH_MODE = (
  location.protocol === 'file:' ||
  location.protocol === 'app:' ||
  location.protocol === 'capacitor:' ||
  // GitHub Pages has no SPA fallback: a direct /repos or /post/:id
  // request is an HTTP 404. Hash routes always request the deployed
  // index document and therefore work on direct visits and reloads.
  location.hostname.endsWith('.github.io')
);

const BASE = (() => {
  if (HASH_MODE) return '';
  const u = new URL(import.meta.url);
  return u.pathname.replace(/js\/router\.js.*$/, '');
})();

export function base() { return BASE; }

export function url(path) {
  const p = String(path || '').replace(/^\//, '');
  return HASH_MODE ? '#/' + p : BASE + p;
}

export function currentPath() {
  let p;
  if (HASH_MODE) {
    const h = location.hash.replace(/^#/, '');
    p = h ? (h.startsWith('/') ? h : '/' + h) : '/';
  } else {
    p = location.pathname;
    if (p.startsWith(BASE)) p = p.slice(BASE.length);
    if (!p.startsWith('/')) p = '/' + p;
    p = p.replace(/index\.html$/, '') || '/';
  }
  // Strip any trailing slash so dispatch() only has to match one form
  // per route. Without this, /settings/ fell through the `===` check
  // and got swallowed by userMatch (which accepts a trailing slash),
  // rendering "@settings は登録されていません". Keep "/" as-is.
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

const handlers = [];
export function onRoute(fn) { handlers.push(fn); fn(currentPath()); rewriteLinks(); }
export function refresh() { handlers.forEach(fn => fn(currentPath())); rewriteLinks(); }

function dispatch() { handlers.forEach(fn => fn(currentPath())); rewriteLinks(); }

export function navigate(path, replace = false) {
  const target = url(path);
  if (HASH_MODE) {
    // hashchange will fire dispatch; if it's the same hash, force.
    if (location.hash === target.replace(/^[^#]*/, '')) dispatch();
    else if (replace) location.replace(target);
    else location.hash = target;
    window.scrollTo({ top: 0 });
    return;
  }
  if (replace) history.replaceState({}, '', target);
  else history.pushState({}, '', target);
  window.scrollTo({ top: 0 });
  dispatch();
}

if (HASH_MODE) window.addEventListener('hashchange', dispatch);
else           window.addEventListener('popstate',   dispatch);

// Rewrite internal links so middle-click / right-click resolve correctly.
export function rewriteLinks(root = document) {
  root.querySelectorAll('a[href^="/"]').forEach(a => {
    const href = a.getAttribute('href');
    if (/^\/\//.test(href)) return; // protocol-relative
    if (HASH_MODE) {
      a.setAttribute('href', '#' + href);
    } else if (BASE !== '/' && !href.startsWith(BASE)) {
      a.setAttribute('href', BASE + href.replace(/^\//, ''));
    }
  });
}

// Intercept clicks on same-origin links to keep navigation in-app.
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a');
  if (!a) return;
  const raw = a.getAttribute('href');
  if (!raw || a.target === '_blank' || a.hasAttribute('download')) return;
  if (/^(https?:|mailto:|tel:)/.test(raw)) return;
  // Let auth-trigger anchors bubble to the app-level handler.
  if (a.hasAttribute('data-auth')) return;

  // In file:// builds we use hash-routing — links are rewritten to
  // `#/foo` and the router treats the part after `#` as the path.
  // But a hash *fragment* like `#likers` (page-internal anchor used by
  // /post/<id>/analytics tile links) must NOT be treated as a path:
  // doing so navigated to /likers and rendered the user-not-found stub.
  // Distinguish: `#/...` is a route, anything else after `#` is a
  // fragment we leave for the browser to scroll to natively.
  let path = raw;
  if (path.startsWith('#')) {
    if (path.startsWith('#/')) path = path.slice(1);
    else return; // pure fragment anchor — let the browser handle it
  }
  if (BASE && BASE !== '/' && path.startsWith(BASE)) path = '/' + path.slice(BASE.length);
  if (!path.startsWith('/')) path = '/' + path;

  e.preventDefault();
  navigate(path);
});
