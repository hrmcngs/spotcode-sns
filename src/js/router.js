// Hybrid router: uses History API on http(s), hash routing on file:// (Electron).
// This lets the same code work both as a static GH Pages site and as a packaged
// Electron app where /spotcode-sns paths are meaningless.

const HASH_MODE = (location.protocol === 'file:' || location.protocol === 'app:');

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
  if (HASH_MODE) {
    const h = location.hash.replace(/^#/, '');
    if (!h) return '/';
    return h.startsWith('/') ? h : '/' + h;
  }
  let p = location.pathname;
  if (p.startsWith(BASE)) p = p.slice(BASE.length);
  if (!p.startsWith('/')) p = '/' + p;
  return p.replace(/index\.html$/, '') || '/';
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

  // Strip hash prefix or BASE prefix to get logical path
  let path = raw;
  if (path.startsWith('#')) path = path.slice(1);
  if (BASE && BASE !== '/' && path.startsWith(BASE)) path = '/' + path.slice(BASE.length);
  if (!path.startsWith('/')) path = '/' + path;

  e.preventDefault();
  navigate(path);
});
