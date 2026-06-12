import { initThemeToggle } from './theme.js';
import { renderGrass }     from './grass.js';
import { onRoute, url, refresh, navigate } from './router.js';
import { renderHome }      from './views/home.js';
import { renderProfile, hydrateProfileBadges } from './views/profile.js';
import { renderStub }      from './views/stub.js';
import { renderSettings, bindSettings } from './views/settings.js';
import { pickSpot }        from './views/spot-picker.js';
import { openAuth }        from './views/auth-modal.js';
import { openEditProfile } from './views/edit-profile-modal.js';
import { openReport }      from './views/report-modal.js';
import { allUsers, addPost } from './data.js';
import { currentUser, logout, onAuthChange } from './auth.js';
import { icon }            from './icons.js';
import { toggleLike, isLiked, likeCount,
         toggleFollow, isFollowing } from './interactions.js';

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
document.getElementById('ic-gear').innerHTML   = icon('gear',   { size: 20 });
document.getElementById('theme-toggle').innerHTML = icon('moon', { size: 16 });
document.querySelector('#open-compose .compose-cta__ico').innerHTML = icon('plus', { size: 18 });
document.querySelectorAll('.side-nav__item').forEach(el => {
  const name = el.getAttribute('data-ico');
  if (name) el.insertAdjacentHTML('afterbegin', '<span class="side-nav__icon">' + icon(name, { size: 22 }) + '</span>');
});

function renderRail() {
  const me = currentUser();
  const others = Object.values(allUsers()).filter(u => !me || u.handle !== me.handle);
  const parts = [
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
  ];
  if (others.length) {
    parts.push(
      '<section class="card">' +
        '<h3>Who to follow</h3>' +
        '<div class="followlist">' +
          others.slice(0, 5).map(u => {
            const f = me && isFollowing(me.handle, u.handle);
            return (
              '<div class="followlist__row">' +
                '<a class="avatar" href="' + url('/' + u.handle) + '">' + u.avatar + '</a>' +
                '<div>' +
                  '<a class="followlist__name" href="' + url('/' + u.handle) + '">' + u.name + '</a>' +
                  '<a class="followlist__handle" href="' + url('/' + u.handle) + '">@' + u.handle + '</a>' +
                '</div>' +
                '<button class="followlist__follow' + (f ? ' is-following' : '') + '" data-target="' + u.handle + '">' +
                  (f ? 'Following' : 'Follow') +
                '</button>' +
              '</div>'
            );
          }).join('') +
        '</div>' +
      '</section>'
    );
  }
  return parts.join('');
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
      '<button class="btn btn--primary btn--sm" data-auth="login">Log in</button>';
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

// Spot picked in the composer for the current home view, kept in memory
// so the timeline can re-render without losing the chosen pin.
let pendingSpot = null;

function dispatch(path) {
  const stubMatch = path.match(/^\/(explore|spots|repos|notifications)\/?$/);
  const userMatch = path.match(/^\/([A-Za-z0-9_]+)\/?$/);

  if (path === '/' || path === '') {
    document.title = 'spotcode-sns';
    app.innerHTML = renderHome();
    if (pendingSpot) syncSpotChip(pendingSpot);
  } else if (path === '/settings') {
    document.title = 'Settings / spotcode-sns';
    app.innerHTML = renderSettings();
    bindSettings();
  } else if (stubMatch) {
    document.title = stubMatch[1] + ' / spotcode-sns';
    app.innerHTML = renderStub(stubMatch[1]);
  } else if (userMatch) {
    const handle = userMatch[1];
    document.title = '@' + handle + ' / spotcode-sns';
    app.innerHTML = renderProfile(handle);
    hydrateProfileBadges(handle);
  } else {
    document.title = 'Not found / spotcode-sns';
    app.innerHTML = '<div class="stub"><h2 class="stub__title">Not found</h2><a class="back-home" href="/">← Back to home</a></div>';
  }
  rail.innerHTML = renderRail();
  setActiveNav(path);
}

function syncSpotChip(spot) {
  const btn = document.getElementById('compose-spot-btn');
  if (!btn) return;
  const textEl = btn.querySelector('[data-spot-text]');
  if (!spot) {
    if (textEl) textEl.textContent = '場所を追加';
    btn.classList.remove('spot-chip--set');
    btn.classList.add('spot-chip--add');
    delete btn.dataset.spotLat;
    delete btn.dataset.spotLng;
    delete btn.dataset.spotLabel;
    const clear = document.getElementById('compose-spot-clear');
    if (clear) clear.hidden = true;
    return;
  }
  const label = spot.label || (spot.lat.toFixed(4) + ', ' + spot.lng.toFixed(4));
  if (textEl) textEl.textContent = label;
  btn.dataset.spotLat   = String(spot.lat);
  btn.dataset.spotLng   = String(spot.lng);
  btn.dataset.spotLabel = spot.label || '';
  btn.classList.add('spot-chip--set');
  btn.classList.remove('spot-chip--add');
  const clear = document.getElementById('compose-spot-clear');
  if (clear) clear.hidden = false;
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
    return;
  }
  if (e.target.closest('#edit-profile-btn')) {
    e.preventDefault();
    if (!currentUser()) return openAuth('login');
    openEditProfile();
    return;
  }

  // Report a post (flag button).
  const reportBtn = e.target.closest('.act--report');
  if (reportBtn) {
    e.preventDefault();
    const me = currentUser();
    if (!me) return openAuth('login');
    const post = reportBtn.closest('[data-post-id]');
    if (!post) return;
    openReport(post.getAttribute('data-post-id'));
    return;
  }

  // Like a post (heart button).
  const likeBtn = e.target.closest('.act--like');
  if (likeBtn) {
    e.preventDefault();
    const me = currentUser();
    if (!me) return openAuth('login');
    const post = likeBtn.closest('[data-post-id]');
    if (!post) return;
    const postId = post.getAttribute('data-post-id');
    const now = toggleLike(postId, me.handle);
    likeBtn.classList.toggle('is-liked', now);
    const span = likeBtn.querySelector('span');
    if (span) {
      const article = likeBtn.closest('article');
      const base = Number(article?.dataset.baseLikes || 0);
      span.textContent = base + likeCount(postId);
    }
    return;
  }

  // Follow / unfollow (profile + Who-to-follow).
  const followBtn = e.target.closest('.btn--follow, .followlist__follow');
  if (followBtn) {
    e.preventDefault();
    const me = currentUser();
    if (!me) return openAuth('login');
    const target = followBtn.getAttribute('data-target');
    if (!target || target === me.handle) return;
    const now = toggleFollow(me.handle, target);
    followBtn.classList.toggle('is-following', now);
    followBtn.classList.toggle('btn--primary', !now);
    followBtn.classList.toggle('btn--ghost', now);
    followBtn.textContent = now ? 'Following' : 'Follow';
    // Refresh the route so any visible follower/following counts re-read.
    refresh();
    return;
  }

  // Clear the picked spot (the small × next to the chip).
  if (e.target.closest('#compose-spot-clear')) {
    e.preventDefault();
    pendingSpot = null;
    syncSpotChip(null);
    return;
  }

  // Open the spot picker (📍 tool button or the spot chip itself).
  const spotTrigger = e.target.closest('[data-spot-pick], #compose-spot-btn');
  if (spotTrigger) {
    e.preventDefault();
    pickSpot().then((result) => {
      if (!result) return;
      pendingSpot = result;
      syncSpotChip(result);
    });
    return;
  }

  // Push button fallback: in case form submit gets eaten elsewhere,
  // explicitly trigger the form when the submit button is clicked.
  const pushBtn = e.target.closest('.composer button[type="submit"]');
  if (pushBtn) {
    const form = pushBtn.closest('form.idea-form');
    if (form && !form.checkValidity()) return; // let HTML5 validation show
    if (form) {
      e.preventDefault();
      form.requestSubmit();
    }
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
  const spotValue = pendingSpot
    ? {
        lat: pendingSpot.lat,
        lng: pendingSpot.lng,
        label: pendingSpot.label || '',
        ...(pendingSpot.address ? { address: pendingSpot.address } : {}),
      }
    : null;
  const post = {
    id: 'p' + Date.now(),
    authorHandle: me.handle,
    body: text,
    githubLink: gh || undefined,
    status: 'wip',
    actions: { replies: 0, forks: 0, stars: 0, likes: 0 },
    createdAt: Date.now(),
  };
  if (spotValue) post.spot = spotValue;
  addPost(post);
  ta.value = '';
  pendingSpot = null;
  refresh();
  window.scrollTo({ top: 0, behavior: 'smooth' });
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
