import { initThemeToggle } from './theme.js';
import { renderGrass }     from './grass.js';
import { onRoute, url, refresh, navigate } from './router.js';
import { renderHome }      from './views/home.js';
import { renderProfile }   from './views/profile.js';
import { renderStub }      from './views/stub.js';
import { openAuth }        from './views/auth-modal.js';
import { allUsers, addPost } from './data.js';
import { currentUser, logout, onAuthChange } from './auth.js';
import { icon }            from './icons.js';

const app  = document.getElementById('app');
const rail = document.getElementById('rail');

const spots = [
  { id: 'shibuya',   lat: 35.659, lng: 139.700, ideaCount: 12 },
  { id: 'akihabara', lat: 35.702, lng: 139.774, ideaCount: 27 },
  { id: 'shimokita', lat: 35.661, lng: 139.668, ideaCount: 5  },
];

const counts = {};
for (let i = 0; i < 53 * 7; i++) {
  const d = new Date(); d.setDate(d.getDate() - i);
  counts[d.toISOString().slice(0, 10)] = Math.floor(Math.random() * 10);
}

// ----- static icon slots that aren't view-rendered -----
document.getElementById('ic-search').innerHTML = icon('search', { size: 16 });
document.getElementById('ic-bell').innerHTML   = icon('bell',   { size: 20 });
document.getElementById('theme-toggle').innerHTML = icon('moon', { size: 16 });
document.querySelector('#open-compose .compose-cta__ico').innerHTML = icon('plus', { size: 18 });
document.querySelectorAll('.side-nav__item').forEach(el => {
  const name = el.getAttribute('data-ico');
  if (name) el.insertAdjacentHTML('afterbegin', '<span class="side-nav__icon">' + icon(name, { size: 22 }) + '</span>');
});

function renderRail() {
  const others = Object.values(allUsers()).filter(u => {
    const me = currentUser();
    return !me || u.handle !== me.handle;
  });
  return [
    '<section class="card">',
      '<h3>Your activity <span class="dim">last 12 months</span></h3>',
      renderGrass(counts),
    '</section>',
    '<section class="card">',
      '<h3>Trending spots</h3>',
      '<div class="trend-list">',
        spots.map((s, i) => (
          '<a class="trend-item" href="' + url('/spots') + '">' +
            '<div class="trend-item__main">' +
              '<span class="trend-item__cat">Trending · #' + (i + 1) + '</span>' +
              '<span class="trend-item__name">' + icon('pin', { size: 14, className: 'icon--inline' }) + s.id + '</span>' +
              '<span class="trend-item__sub">' + s.lat.toFixed(3) + ', ' + s.lng.toFixed(3) + '</span>' +
            '</div>' +
            '<span class="trend-item__count">' + s.ideaCount + ' ideas</span>' +
          '</a>'
        )).join(''),
      '</div>',
    '</section>',
    '<section class="card">',
      '<h3>Who to follow</h3>',
      '<div class="followlist">',
        others.slice(0, 5).map(u => (
          '<div class="followlist__row">' +
            '<a class="avatar" href="' + url('/' + u.handle) + '">' + u.avatar + '</a>' +
            '<div>' +
              '<a class="followlist__name" href="' + url('/' + u.handle) + '">' + u.name + '</a>' +
              '<a class="followlist__handle" href="' + url('/' + u.handle) + '">@' + u.handle + '</a>' +
            '</div>' +
            '<button class="followlist__follow">Follow</button>' +
          '</div>'
        )).join(''),
      '</div>',
    '</section>',
  ].join('');
}

function setActiveNav(path) {
  document.querySelectorAll('.side-nav__item').forEach(el => {
    const route = el.getAttribute('data-route');
    if (!route) { el.classList.remove('is-active'); return; }
    el.classList.toggle('is-active', route === path);
  });
}

function renderAuthArea() {
  const slot = document.getElementById('auth-area');
  if (!slot) return;
  const me = currentUser();
  if (me) {
    slot.innerHTML =
      '<a class="avatar avatar--me" href="' + url('/' + me.handle) + '" title="' + me.name + '">' + me.avatar + '</a>';
  } else {
    slot.innerHTML =
      '<button class="btn btn--ghost btn--sm" data-auth="login">Log in</button>' +
      '<button class="btn btn--primary btn--sm" data-auth="register">Sign up</button>';
  }
}

function renderSideMe() {
  const slot = document.getElementById('side-me');
  if (!slot) return;
  const me = currentUser();
  if (me) {
    slot.innerHTML =
      '<a class="me-card" href="' + url('/' + me.handle) + '">' +
        '<div class="avatar avatar--lg">' + me.avatar + '</div>' +
        '<div class="me-card__text">' +
          '<div class="me-card__name">' + me.name + '</div>' +
          '<div class="me-card__handle">@' + me.handle + '</div>' +
        '</div>' +
      '</a>';
  } else {
    slot.innerHTML =
      '<button class="btn btn--ghost btn--block" data-auth="login">Log in</button>';
  }
  // Profile side-nav item: link to own profile when logged in,
  // otherwise turn it into a login trigger.
  const profileLink = document.querySelector('.side-nav__item[data-nav="profile"]');
  if (profileLink) {
    if (me) {
      profileLink.setAttribute('href', '/' + me.handle);
      profileLink.setAttribute('data-route', '/' + me.handle);
      profileLink.removeAttribute('data-auth');
    } else {
      profileLink.setAttribute('href', '/');
      profileLink.removeAttribute('data-route');
      profileLink.setAttribute('data-auth', 'login');
    }
  }
}

function dispatch(path) {
  const stubMatch = path.match(/^\/(explore|spots|repos|notifications)\/?$/);
  const userMatch = path.match(/^\/([A-Za-z0-9_]+)\/?$/);

  if (path === '/' || path === '') {
    document.title = 'spotcode-sns';
    app.innerHTML = renderHome();
  } else if (stubMatch) {
    document.title = stubMatch[1] + ' / spotcode-sns';
    app.innerHTML = renderStub(stubMatch[1]);
  } else if (userMatch) {
    const handle = userMatch[1];
    document.title = '@' + handle + ' / spotcode-sns';
    app.innerHTML = renderProfile(handle);
  } else {
    document.title = 'Not found / spotcode-sns';
    app.innerHTML = '<div class="stub"><h2 class="stub__title">Not found</h2><a class="back-home" href="/">← Back to home</a></div>';
  }
  rail.innerHTML = renderRail();
  setActiveNav(path);
}

initThemeToggle(document.getElementById('theme-toggle'));
onRoute(dispatch);
renderAuthArea();
renderSideMe();

onAuthChange(() => {
  renderAuthArea();
  renderSideMe();
  refresh();
});

// ----- delegated UI events -----

document.getElementById('open-compose')?.addEventListener('click', () => {
  if (!currentUser()) return openAuth('register');
  navigate('/');
  setTimeout(() => {
    document.querySelector('.composer textarea')?.focus();
  }, 30);
});

document.addEventListener('click', (e) => {
  const auth = e.target.closest('[data-auth]');
  if (auth) {
    e.preventDefault();
    openAuth(auth.dataset.auth === 'register' ? 'register' : 'login');
    return;
  }
  if (e.target.closest('#logout-btn')) {
    e.preventDefault();
    logout();
    navigate('/');
  }
});

// Posting a new idea.
document.addEventListener('submit', (e) => {
  const form = e.target.closest('.idea-form');
  if (!form) return;
  e.preventDefault();
  const me = currentUser();
  if (!me) return openAuth('register');
  const ta = form.querySelector('textarea[name="text"]');
  const text = ta.value.trim();
  if (!text) return;
  const gh = form.querySelector('input[name="github"]').value.trim();
  addPost({
    id: 'p' + Date.now(),
    authorHandle: me.handle,
    spot: form.dataset.spot || 'somewhere',
    body: text,
    githubLink: gh || undefined,
    status: 'wip',
    actions: { replies: 0, forks: 0, stars: 0, likes: 0 },
    createdAt: Date.now(),
  });
  ta.value = '';
  refresh();
});

// Auto-grow the composer textarea as the user types.
document.addEventListener('input', (e) => {
  const ta = e.target;
  if (!(ta instanceof HTMLTextAreaElement)) return;
  if (!ta.closest('.composer')) return;
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 320) + 'px';
});

// ----- keyboard shortcuts -----
function isTyping(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

document.addEventListener('keydown', (e) => {
  // "/" focuses the topbar search (matches the kbd hint shown next to it).
  if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) {
    const search = document.querySelector('.topbar__search input');
    if (search) {
      e.preventDefault();
      search.focus();
      search.select();
    }
    return;
  }

  // Cmd/Ctrl+Enter submits the composer while focused inside the textarea.
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    const ta = e.target;
    if (ta instanceof HTMLTextAreaElement && ta.closest('.idea-form')) {
      e.preventDefault();
      ta.form?.requestSubmit();
    }
  }
});
