import { getUser, postsByHandle, likedPostsByHandle } from '../data.js';
import { renderPost }              from '../post.js';
import { url, currentPath }        from '../router.js';
import { currentUser }             from '../auth.js';
import { isPostingAsOfficial } from '../posting-identity.js';
import { OFFICIAL_HANDLE }         from '../official-account.js';
import { icon }                    from '../icons.js';
import { isFollowing, isRequested, followerCount, followingCount,
         hydratePostLikes, hydrateRepostsMine, hydrateBookmarksMine, hydratePolls,
         hydrateProfileFollow, isOfficialFollowing } from '../interactions.js';
import { hydrateQuotedPosts, cachedPosts } from '../data.js';
import { renderTimelineSkeleton } from '../skeleton.js';
import { quickNavLinks } from '../quick-nav.js';
import { renderAvatar } from '../avatar.js';
import { fetchProfileByHandle } from '../profiles.js';
import { t } from '../i18n.js';
import { renderGrass } from '../grass.js';
import { fetchContributions, cachedContributions } from '../github-activity.js';
import { getLanguageStats, cachedLanguageStats, langColor, langAbbr, langTextColor } from '../language-stats.js';

// (Previously a `let renderVersion = 0` lived here as the freshness
//  flag for async hydrations. It's been replaced with path-based
//  `stillHere()` checks inside hydrateProfile / hydrateProfileBody —
//  the version counter bumped on every dispatch and ate completed
//  fetches whenever an unrelated refresh fired mid-load, leaving
//  the page stuck on the loading skeleton.)

function escAttr(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// Normalise a website URL for display: hide the protocol so the row
// stays scannable. The link itself still points at the real URL.
function prettyUrl(u) {
  try {
    const url = new URL(u);
    return (url.host + url.pathname + url.search).replace(/\/$/, '');
  } catch { return u; }
}

// Render the row of social links shown under the profile-meta line.
// Empty when the user has set none, so existing profiles render the
// same as before this PR.
function renderProfileLinks(u) {
  const links = [];
  if (u.website) {
    const href = /^https?:\/\//i.test(u.website) ? u.website : 'https://' + u.website;
    links.push(
      '<a class="profile-link" href="' + escAttr(href) + '" target="_blank" rel="noopener nofollow">' +
        icon('globe', { size: 14, className: 'icon--inline' }) +
        '<span>' + escAttr(prettyUrl(href)) + '</span>' +
      '</a>'
    );
  }
  if (u.twitter) {
    links.push(
      '<a class="profile-link" href="https://x.com/' + escAttr(u.twitter) + '" target="_blank" rel="noopener nofollow">' +
        icon('twitter', { size: 14, className: 'icon--inline' }) +
        '<span>@' + escAttr(u.twitter) + '</span>' +
      '</a>'
    );
  }
  if (u.instagram) {
    links.push(
      '<a class="profile-link" href="https://instagram.com/' + escAttr(u.instagram) + '" target="_blank" rel="noopener nofollow">' +
        icon('instagram', { size: 14, className: 'icon--inline' }) +
        '<span>@' + escAttr(u.instagram) + '</span>' +
      '</a>'
    );
  }
  if (!links.length) return '';
  return '<div class="profile-links">' + links.join('') + '</div>';
}

// Member list for organization accounts. The `org_members` column was
// originally the "same-org audience" allowlist on personal accounts;
// on an `is_org` profile it doubles as the public roster the org
// publishes. Empty + non-owner viewer → render nothing so we don't
// pollute the layout with a blank section.
function renderOrgMembers(u) {
  if (!u.isOrg) return '';
  const me = currentUser();
  const isOwner = me && me.handle === u.handle;
  const handles = Array.isArray(u.orgMembers) ? u.orgMembers : [];
  if (!handles.length && !isOwner) return '';
  if (!handles.length) {
    return (
      '<section class="profile-members" id="profile-members-' + u.handle + '">' +
        '<h3 class="profile-members__title">' + t('profile.org_members.title') +
          ' <span class="profile-members__count">0</span>' +
        '</h3>' +
        '<p class="profile-members__empty">' + t('profile.org_members.empty_owner') + '</p>' +
      '</section>'
    );
  }
  // GitHub-org-style: compact avatar-only tiles with the name as a
  // hover tooltip. The CSS hides .profile-members__text on this
  // variant so the avatar grid stays tight (GitHub's "People" panel
  // is just rounded-square avatars in a 7-wide grid).
  return (
    '<section class="profile-members profile-members--gh" id="profile-members-' + u.handle + '">' +
      '<h3 class="profile-members__title">' + t('profile.org_members.title') +
        ' <span class="profile-members__count">' + handles.length + '</span>' +
      '</h3>' +
      '<div class="profile-members__grid">' +
        handles.map(h => {
          const m = getUser(h) || { handle: h, name: h, avatar: (h[0] || '?').toUpperCase() };
          // Force square avatar to mirror GitHub's people tile look.
          const tile = Object.assign({}, m, { avatarShape: 'square' });
          const label = (m.name && m.name !== h) ? (m.name + ' (@' + h + ')') : ('@' + h);
          return (
            '<a class="profile-members__row" href="' + url('/' + h) + '" title="' + escAttr(label) + '" aria-label="' + escAttr(label) + '">' +
              renderAvatar(tile, { size: 'md' }) +
              '<span class="profile-members__text">' +
                '<span class="profile-members__name">' + escAttr(m.name || h) + '</span>' +
                '<span class="profile-members__handle">@' + escAttr(h) + '</span>' +
              '</span>' +
            '</a>'
          );
        }).join('') +
      '</div>' +
    '</section>'
  );
}

// Tiered styling for the ×N pill — three metal palettes (bronze,
// silver, gold), each cycling through three modes (border-only →
// text-only → whole). 9 tier slots in total for ×2..×10; ×11+
// drops back to the language's Linguist colour (the default).
//
//   ×2  bronze border       ×5  silver border       ×8   gold border
//   ×3  bronze text         ×6  silver text         ×9   gold text
//   ×4  bronze whole        ×7  silver whole        ×10  gold whole
//   ×11+ language colour (current default)
function medalTier(n) {
  if (!(n >= 2) || n >= 11) return null;
  const metals = ['bronze', 'silver', 'gold'];
  const modes  = ['border', 'text', 'whole'];
  const idx    = n - 2;
  return { metal: metals[Math.floor(idx / 3)], mode: modes[idx % 3] };
}

// Round GitHub-Achievements-style medal for one language. Background
// is the Linguist colour, abbreviation in YIQ-picked contrast. If
// `repoCount` is given (>= 2), render a small ×N stack indicator in
// the corner — same idea as GitHub's "earned ×3" overlay on medals.
function renderLangMedal(name, pct, repoCount) {
  const c = langColor(name);
  const tc = langTextColor(c);
  const titleParts = [name];
  if (pct != null)        titleParts.push(pct + '%');
  if (repoCount != null)  titleParts.push(repoCount + ' repo' + (repoCount === 1 ? '' : 's'));
  const title = titleParts.join(' · ');
  const tier = (typeof repoCount === 'number') ? medalTier(repoCount) : null;
  const stackCls = (typeof repoCount === 'number' && repoCount >= 2)
    ? 'lang-medal__count' +
      (tier ? ' lang-medal__count--' + tier.metal + ' lang-medal__count--' + tier.mode : '')
    : '';
  const stack = stackCls
    ? '<span class="' + stackCls + '" aria-hidden="true">×' + repoCount + '</span>'
    : '';
  return (
    '<span class="lang-medal' + (stack ? ' lang-medal--stacked' : '') + '" ' +
      'style="--lm-bg:' + c + ';--lm-fg:' + tc + ';" ' +
      'title="' + escAttr(title) + '" aria-label="' + escAttr(title) + '">' +
      '<span class="lang-medal__abbr">' + escAttr(langAbbr(name)) + '</span>' +
      stack +
    '</span>'
  );
}

// Top-N round medals to sit next to the `{}` programmer badge in the
// profile-name row. Returns '' when there's no data — the slot stays
// empty until hydrateProfileLanguages fills it in. `repoCounts` is the
// optional `{ [lang]: count }` map from language-stats; passing it
// turns on the ×N stack indicator.
function renderLangMedalStrip(langs, repoCounts, n = 4) {
  if (!Array.isArray(langs) || !langs.length) return '';
  const total = langs.reduce((a, [, b]) => a + (b || 0), 0) || 1;
  return langs.slice(0, n).map(([name, bytes]) => {
    const pct = Math.round((bytes / total) * 100);
    const count = repoCounts ? repoCounts[name] : undefined;
    return renderLangMedal(name, pct, count);
  }).join('');
}

// 53 weeks × 7 days of zeros — gives renderGrass() something to paint
// while we wait for the real GitHub data to come back.
function emptyGrid() {
  const out = {};
  for (let i = 0; i < 53 * 7; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    out[d.toISOString().slice(0, 10)] = 0;
  }
  return out;
}

// In-memory current tab per profile view. Not in the URL — clicking a tab
// stays on /<handle> but swaps the body via hydrateProfileBody().
let activeTab = 'posts';
const TABS = ['posts', 'spots', 'likes'];
function tabLabel(key) { return t('profile.tab.' + key); }

function notFound(handle) {
  return (
    '<div class="stub">' +
      '<h2 class="stub__title">@' + handle + ' ' + t('profile.not_found.title') + '</h2>' +
      '<p class="stub__sub">' + t('profile.not_found.sub') + '</p>' +
    '</div>' +
    quickNavLinks()
  );
}

function loading(handle) {
  return (
    '<div class="stub" id="profile-loading">' +
      '<h2 class="stub__title">@' + handle + '</h2>' +
      '<p class="stub__sub">' + t('profile.loading') + '</p>' +
    '</div>'
  );
}

export function renderProfile(handle) {
  const u = getUser(handle);
  // No local cache yet — show a loading skeleton; hydrateProfile() will
  // fetch from Supabase and re-render this card.
  if (!u) return loading(handle);

  const me = currentUser();
  // The "posting as official" overlay flips your effective identity
  // wholesale. Each value below is computed against the OVERLAY
  // identity, not the underlying Supabase session:
  //
  //   overlay OFF + viewing /hrmcngs           → self (Edit)
  //   overlay OFF + viewing /spotcode_official → other (Follow)
  //   overlay ON  + viewing /hrmcngs           → other (Follow) ← user asked
  //   overlay ON  + viewing /spotcode_official → self (no Follow,
  //                                              no Edit — RLS blocks)
  //
  // `canEdit` only fires for the real auth user when the overlay is
  // OFF (Edit submits a profiles UPDATE that RLS would reject
  // otherwise). `viewingSelfRow` is the "hide Follow / Requested"
  // gate — overlay flips its target from your real handle to the
  // brand handle.
  const overlayOn = !!(me && isPostingAsOfficial());
  const canEdit = !!(me && !overlayOn && me.handle === u.handle);
  const viewingSelfRow = overlayOn
    ? u.handle === OFFICIAL_HANDLE
    : !!(me && me.handle === u.handle);
  const isMe = canEdit || viewingSelfRow;
  const ghLink = u.github?.url || (u.github?.handle ? 'https://github.com/' + u.github.handle : null);
  // Counts come from Supabase via hydrateProfileFollow; the cache returns
  // 0 until then, which is fine — hydrateProfile re-renders after fill.
  const followingN = followingCount(u.handle);
  const followersN = followerCount(u.handle);
  // Display follow state from the OVERLAY identity's perspective:
  // while overlay is on, "Following" must reflect what
  // @spotcode_official follows, not what hrmcngs does. Click still
  // executes as the auth user (overlay doesn't write follows on the
  // brand's behalf), but the visible badge has to match the role.
  const followed   = me && !isMe && (overlayOn ? isOfficialFollowing(u.handle) : isFollowing(me.handle, u.handle));
  const requested  = me && !isMe && !overlayOn && isRequested(me.handle, u.handle);
  // Follow-button text/style depends on (target privacy) × (current state).
  const followBtnLabel = followed   ? 'Following'
                       : requested  ? 'Requested'
                       : u.isPrivate ? 'Request'
                       :              'Follow';
  const followBtnCls   = (followed || requested) ? 'btn--ghost is-following' : 'btn--primary';

  // GitHub-org-style header: square avatar, "Organization" subtitle in
  // place of the small inline badge, and a header modifier class the
  // CSS uses to swap in a compact People grid. Personal accounts get
  // the original layout — only `is_org` profiles change.
  const orgU = u.isOrg ? Object.assign({}, u, { avatarShape: 'square' }) : u;
  const header = (
    '<header class="profile-header' + (u.isOrg ? ' profile-header--org' : '') + '">' +
      '<div class="profile-cover"></div>' +
      '<div class="profile-top">' +
        renderAvatar(orgU, { size: 'xl' }) +
        '<div class="profile-top__actions">' +
          // Edit only fires when the row actually belongs to the
          // auth user AND the overlay is off (canEdit).
          // Hide Follow / More for two "self" cases:
          //   • viewingSelfRow — overlay-aware self (e.g. overlay
          //     on + /spotcode_official, or overlay off + /hrmcngs).
          //   • overlay ON + /hrmcngs (auth-self while overlay on)
          //     — follow click would alert "自分自身はフォロー…" at
          //     the auth layer, hide it to avoid the dead end.
          // Everyone else gets Follow + More — clicks execute as
          // the auth user (overlay doesn't affect follow inserts).
          (canEdit
            ? '<button class="btn btn--primary" id="edit-profile-btn">' + t('profile.btn.edit') + '</button>'
            : (viewingSelfRow || (overlayOn && me && me.handle === u.handle))
              ? ''
              : '<button class="btn btn--ghost" id="profile-more-btn" data-profile-more="' + u.handle + '" aria-haspopup="menu" aria-expanded="false">' + t('profile.btn.more') + '</button>' +
                '<button class="btn ' + followBtnCls + ' btn--follow" data-target="' + u.handle + '">' +
                  followBtnLabel +
                '</button>') +
        '</div>' +
      '</div>' +
      '<div class="profile-id">' +
        '<div class="profile-name">' + u.name +
          // Unconditional {} for non-org users — the previous
          // role / github-handle gating was hiding it for too many
          // accounts whose DB fields weren't populated as expected.
          // Org accounts are different (they get the Organization
          // subtitle below the name instead).
          (!u.isOrg ? ' <span class="role-badge role-badge--prog" title="Programmer">{ }</span>' : '') +
          // Round language medals next to the {} badge, cache-painted
          // here and re-populated by hydrateProfileLanguages. Empty
          // until first fetch resolves so we don't show a placeholder
          // sitting awkwardly next to the name.
          (u.github?.handle && !u.isOrg
            ? ' <span class="profile-lang-medals" id="profile-lang-medals-' + u.handle + '" data-gh="' + u.github.handle + '">' +
                (() => {
                  const c = cachedLanguageStats(u.github.handle);
                  return c ? renderLangMedalStrip(c.langs, c.repoCounts) : '';
                })() +
              '</span>'
            : '') +
        '</div>' +
        (u.isOrg
          ? '<div class="profile-org-subtitle">' +
              icon('building', { size: 14, className: 'icon--inline' }) +
              t('profile.badge.org') +
            '</div>'
          : '') +
        '<div class="profile-handle">@' + u.handle +
          (u.isPrivate ? ' <span class="profile-lock" title="非公開アカウント">' + icon('lock', { size: 12, className: 'icon--inline' }) + '</span>' : '') +
        '</div>' +
      '</div>' +
      (u.bio ? '<p class="profile-bio">' + u.bio + '</p>' : '') +
      '<div class="profile-meta">' +
        (u.location ? '<span>' + icon('pin',      { size: 14, className: 'icon--inline' }) + u.location + '</span>' : '') +
        (u.joined   ? '<span>' + icon('calendar', { size: 14, className: 'icon--inline' }) + t('profile.joined') + u.joined + '</span>' : '') +
        (ghLink ? '<a class="profile-gh" href="' + ghLink + '" target="_blank" rel="noopener" title="' +
                    (u.github?.verified ? '本人確認済み' : '未確認') + '">' +
                    icon('github', { size: 14, fill: true, className: 'icon--inline' }) + (u.github.handle || '') +
                    (u.github?.verified ? ' <span class="gh-verified" title="本人確認済み">✓</span>' : '') +
                  '</a>' : '') +
      '</div>' +
      renderProfileLinks(u) +
      '<div class="profile-stats">' +
        '<a href="' + url('/' + u.handle + '/following') + '"><b>' + followingN + '</b> ' + t('profile.stat.following') + '</a>' +
        '<a href="' + url('/' + u.handle + '/followers') + '"><b>' + followersN + '</b> ' + t('profile.stat.followers') + '</a>' +
        '<span><b id="profile-postcount">…</b> ' + t('profile.stat.posts') + '</span>' +
      '</div>' +
      renderOrgMembers(u) +
      (u.github?.handle
        ? '<div class="profile-activity" id="profile-activity-' + u.handle + '" data-gh="' + u.github.handle + '">' +
            '<div class="profile-activity__head">' +
              icon('github', { size: 12, fill: true, className: 'icon--inline' }) +
              ' GitHub activity ' +
              '<span class="profile-activity__hint">last 12 months</span>' +
            '</div>' +
            '<div class="profile-activity__graph">' +
              renderGrass(cachedContributions(u.github.handle) || emptyGrid()) +
            '</div>' +
          '</div>'
        : '') +
    '</header>'
  );

  const tabs = (
    '<div class="timeline__head">' +
      TABS.map(key => (
        '<button type="button" class="tab' + (key === activeTab ? ' is-active' : '') + '" ' +
          'data-profile-tab="' + key + '" data-profile-handle="' + handle + '">' +
          tabLabel(key) +
        '</button>'
      )).join('') +
    '</div>'
  );

  const cached = activeTab === 'posts' ? cachedPosts('handle:' + handle) : null;
  const initial = (cached && cached.length)
    ? cached.map(renderPost).join('')
    : renderTimelineSkeleton(3);
  const body = '<div id="profile-posts">' + initial + '</div>';

  return header + tabs + body;
}

// In-flight hydration dedupe. dispatch() in main.js fires from many
// triggers (initial onRoute, onAuthChange's refresh, the official
// overlay flip's refresh, fetchContributions, …), and each fires its
// own `hydrateProfile(handle)`. Without dedupe two or more of these
// run concurrently and race on `app.innerHTML = renderProfile(...)`
// and on the inner #profile-posts writes; one of them stalling on a
// Supabase auth-refresh leaves the page stuck on the post skeleton
// even though another already had the data ready. By short-circuiting
// to the in-flight Promise we guarantee at most one hydration per
// handle and the user reliably sees the posts on first paint.
const inFlight = new Map(); // handle → Promise

export function hydrateProfile(handle) {
  const existing = inFlight.get(handle);
  if (existing) return existing;
  const p = doHydrateProfile(handle).finally(() => {
    // Only clear if THIS run is still the registered one — a follow-up
    // call after we'd resolved would have replaced the slot, and we
    // mustn't wipe its newer entry.
    if (inFlight.get(handle) === p) inFlight.delete(handle);
  });
  inFlight.set(handle, p);
  return p;
}

async function doHydrateProfile(handle) {
  // Guard by the actual current route, not a monotonic renderVersion
  // — the version counter bumped on every dispatch (auth refresh,
  // GitHub-graph fetch's refresh, overlay flip, etc.), and the
  // matching pre-await capture often went stale before the DOM got
  // its update, leaving the page stuck on the loading skeleton.
  const myPath = '/' + handle;
  const stillHere = () => currentPath() === myPath;
  const me = currentUser();
  const isMe = me && me.handle === handle;
  // Always go to Supabase for other users' profiles so their avatar /
  // bio / shape changes propagate without waiting for a session reset.
  // For your own profile, currentUser() is already the freshest source.
  if (!isMe) {
    let fetched;
    try { fetched = await fetchProfileByHandle(handle); }
    catch (err) {
      if (!stillHere()) return;
      const app = document.getElementById('app');
      if (app) app.innerHTML = '<div class="stub"><h2 class="stub__title">読み込みに失敗しました</h2><p class="stub__sub">' + (err.message || '') + '</p></div>';
      return;
    }
    if (!stillHere()) return;
    if (!fetched) {
      const app = document.getElementById('app');
      if (app) app.innerHTML = notFound(handle);
      return;
    }
  }
  await hydrateProfileFollow(handle);
  if (!stillHere()) return;
  // Reset the tab to Posts whenever a fresh profile is opened so the new
  // page never inherits the active tab of the previous one.
  activeTab = 'posts';
  const app = document.getElementById('app');
  if (app) app.innerHTML = renderProfile(handle);
  hydrateOrgMembers(handle).catch(() => {});
  await hydrateProfileBody(handle);
}

// For org accounts: members are listed by handle only; fetch the full
// profile for any that aren't in the local cache so the row paints
// the right avatar + display name instead of a handle-only stub.
async function hydrateOrgMembers(handle) {
  const u = getUser(handle);
  if (!u || !u.isOrg) return;
  const handles = Array.isArray(u.orgMembers) ? u.orgMembers : [];
  if (!handles.length) return;
  const missing = handles.filter(h => {
    const m = getUser(h);
    return !m || (!m.avatarImage && (!m.name || m.name === h));
  });
  if (!missing.length) return;
  await Promise.allSettled(missing.map(h => fetchProfileByHandle(h)));
  // Repaint just the members section so the rest of the profile
  // isn't disturbed mid-tab-load.
  const sec = document.getElementById('profile-members-' + u.handle);
  if (!sec) return;
  const fresh = getUser(handle);
  if (!fresh) return;
  const html = renderOrgMembers(fresh);
  if (html) sec.outerHTML = html;
}

// Called from main.js when the user clicks one of the profile tabs.
// Updates the active tab, swaps the is-active class, and refetches the
// body for the new tab.
export async function setProfileTab(handle, tab) {
  if (!TABS.includes(tab) || tab === activeTab) return;
  activeTab = tab;
  document.querySelectorAll('[data-profile-tab]').forEach(el => {
    el.classList.toggle('is-active', el.getAttribute('data-profile-tab') === tab);
  });
  const list = document.getElementById('profile-posts');
  if (list) list.innerHTML = '<div class="stub"><p class="stub__sub">' + t('follow.loading') + '</p></div>';
  await hydrateProfileBody(handle);
}

async function hydrateProfileBody(handle) {
  const myPath = '/' + handle;
  const stillHere = () => currentPath() === myPath;
  // Re-resolve the slot after each await — a refresh() between start
  // and resolve replaces #profile-posts with a fresh element, and
  // writing to the stale orphan reference is invisible.
  const slot = () => document.getElementById('profile-posts');

  if (!slot()) return;

  // Private accounts: if the viewer isn't the owner and isn't an
  // accepted follower, the Posts RLS already drops their rows so we'd
  // just paint the generic empty state. Give a clearer message instead.
  const u = getUser(handle);
  const me = currentUser();
  const blockedByPrivacy = u && u.isPrivate
    && (!me || (me.handle !== handle && !isFollowing(me.handle, handle)));
  if (blockedByPrivacy) {
    const requested = me && isRequested(me.handle, handle);
    const list = slot();
    if (!list) return;
    list.innerHTML =
      '<div class="stub">' +
        '<h2 class="stub__title">' + icon('lock', { size: 18, className: 'icon--inline' }) + 'このアカウントは非公開です</h2>' +
        '<p class="stub__sub">' +
          (requested
            ? '<strong>承認待ち</strong>です。@' + handle + ' が承認すると投稿が見られるようになります。'
            : 'フォローして承認されると投稿が見られるようになります。') +
        '</p>' +
      '</div>';
    const countEl = document.getElementById('profile-postcount');
    if (countEl) countEl.textContent = '?';
    return;
  }

  const tab = activeTab;
  let posts;
  try {
    if (tab === 'likes')      posts = await likedPostsByHandle(handle);
    else if (tab === 'spots') posts = (await postsByHandle(handle)).filter(p => p.spot);
    else                      posts = await postsByHandle(handle);
  } catch (err) {
    if (!stillHere()) return;
    console.error('hydrateProfileBody', err);
    const list = slot();
    if (list) list.innerHTML = '<div class="stub"><p class="stub__sub">取得に失敗しました: ' + (err.message || '') + '</p></div>';
    return;
  }
  if (!stillHere()) return;
  // Only the Posts tab drives the header "Posts" count.
  if (tab === 'posts') {
    const countEl = document.getElementById('profile-postcount');
    if (countEl) countEl.textContent = String(posts.length);
  }
  {
    const list = slot();
    if (!list) return;
    if (!posts.length) {
      const empty = tab === 'likes' ? t('profile.empty.likes')
                  : tab === 'spots' ? t('profile.empty.spots')
                  :                   t('profile.empty.posts');
      list.innerHTML = '<div class="stub"><p class="stub__sub">' + empty + '</p></div>';
      return;
    }
    list.innerHTML = posts.map(renderPost).join('');
  }
  const ids = posts.map(p => p.id);
  try {
    await Promise.all([
      hydratePostLikes(ids),
      hydrateRepostsMine(ids),
      hydrateBookmarksMine(ids),
      hydrateQuotedPosts(posts),
    ]);
  } catch (err) { console.warn('hydrate batch (profile)', err); return; }
  if (!stillHere()) return;
  {
    const list = slot();
    if (!list) return;
    list.innerHTML = posts.map(renderPost).join('');
  }
  hydratePolls(posts).catch(() => {});
}

// Per-handle dedupe for both badge and activity hydration. main.js's
// `onAuthChange → refresh()` re-runs dispatch() on every auth-state
// event (INITIAL_SESSION + SIGNED_IN can both fire on a single boot),
// which re-rendered the profile and re-triggered hydration each
// time. The activity grass replaced `slot.innerHTML` on each call →
// visible flicker. Badges meanwhile got removed via `slot.remove()`
// on the first run and stayed gone (because the new render shell
// didn't include the section once it had been hidden by an earlier
// "no badges" outcome). Caching keeps the DOM stable.
// Dedupe lives on the DOM slot via `data-hydrating` rather than on a
// module-scoped Map keyed by handle. The Map version persisted
// across SPA navigations, so visiting /aya → /hrmcngs → /aya the
// second time saw `hydratedBadges.has('aya') === 'done'` and skipped
// hydration entirely, leaving the freshly-rendered placeholder
// stuck on "バッジを取得中…" forever. Per-slot state automatically
// resets when renderProfile blows away the DOM, which is what we
// want for both the navigation case and the onAuthChange re-render
// case (same DOM = same dedupe; new DOM = re-run).

// (Removed — the skill-badges feature was dropped wholesale.
// hydrateProfileBadges + renderBadgeMedal + the click-opened
// detail modal all lived here.)

// (Removed resetProfileHydrationCache — dedupe now lives on the DOM
// slot's dataset, which resets automatically on each renderProfile
// re-render. No module-level map left to clear.)

// "More" popover handler. Wired from main.js's delegated click
// listener (`#profile-more-btn`). Mounts a singleton menu the first
// time it's needed and positions it under the button. Two actions:
//   - Copy profile link → navigator.clipboard
//   - Report user → confirm + prompt for a free-text reason, then
//     write to localStorage `spotcode:user-reports` so operators can
//     review later. (Schema-backed reporting is a follow-up.)
let moreMenuEl = null;
function ensureMoreMenu() {
  if (moreMenuEl) return moreMenuEl;
  moreMenuEl = document.createElement('div');
  moreMenuEl.className = 'profile-more-menu';
  moreMenuEl.setAttribute('role', 'menu');
  moreMenuEl.hidden = true;
  document.body.appendChild(moreMenuEl);
  document.addEventListener('click', (e) => {
    if (!moreMenuEl || moreMenuEl.hidden) return;
    if (moreMenuEl.contains(e.target)) return;
    if (e.target.closest('[data-profile-more]')) return;
    closeMoreMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && moreMenuEl && !moreMenuEl.hidden) closeMoreMenu();
  });
  return moreMenuEl;
}
function closeMoreMenu() {
  if (!moreMenuEl) return;
  moreMenuEl.hidden = true;
  const trigger = document.getElementById('profile-more-btn');
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
}
export function openProfileMore(handle, anchor) {
  const menu = ensureMoreMenu();
  menu.innerHTML =
    '<button type="button" class="profile-more-menu__item" data-more-action="copy">' +
      icon('share', { size: 14, className: 'icon--inline' }) +
      t('profile.more.copy_link') +
    '</button>' +
    '<button type="button" class="profile-more-menu__item profile-more-menu__item--bad" data-more-action="report">' +
      icon('flag', { size: 14, className: 'icon--inline' }) +
      t('profile.more.report') +
    '</button>';
  const r = anchor.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top  = (r.bottom + 6) + 'px';
  menu.style.left = Math.max(8, r.right - 220) + 'px';
  menu.hidden = false;
  if (anchor.setAttribute) anchor.setAttribute('aria-expanded', 'true');

  menu.onclick = async (e) => {
    const btn = e.target.closest('[data-more-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-more-action');
    closeMoreMenu();
    if (action === 'copy') {
      const link = location.origin + url('/' + handle);
      try {
        await navigator.clipboard.writeText(link);
        toast(t('profile.more.copied'));
      } catch {
        // Fallback for browsers without clipboard API access (older
        // Safari without HTTPS, etc.) — show the link in a prompt so
        // the user can copy manually.
        prompt(t('profile.more.copy_manual'), link);
      }
    } else if (action === 'report') {
      const me = currentUser();
      if (!me) return;
      if (!confirm(t('profile.more.report_confirm').replace('{handle}', handle))) return;
      const reason = prompt(t('profile.more.report_prompt')) || '';
      if (!reason.trim()) return;
      try {
        const KEY = 'spotcode:user-reports';
        const list = JSON.parse(localStorage.getItem(KEY) || '[]');
        list.push({
          target: handle,
          reporter: me.handle,
          reason: reason.trim().slice(0, 400),
          ts: Date.now(),
        });
        localStorage.setItem(KEY, JSON.stringify(list));
      } catch {}
      toast(t('profile.more.report_sent'));
    }
  };
}

// Lightweight non-blocking toast — single shared element, fades after
// 2s. The popover uses it for "リンクをコピーしました" / "通報を受け
// 付けました" so the user gets visible feedback without a modal.
let toastEl = null;
function toast(text) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'profile-toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = text;
  toastEl.classList.add('is-show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove('is-show'), 2000);
}

// Per-repo `/languages` aggregation: fetch once on first paint and
// fill the round medal strip next to the {} programmer badge. Per-
// slot `data-hydrating` dedupe so onAuthChange re-renders don't
// re-trigger the fetch.
export async function hydrateProfileLanguages(handle) {
  const u = getUser(handle);
  const gh = u?.github?.handle;
  if (!gh || u.isOrg) return;
  const medals = document.getElementById('profile-lang-medals-' + u.handle);
  if (!medals) return;
  if (medals.dataset.hydrating === '1') return;
  medals.dataset.hydrating = '1';
  try {
    const stats = await getLanguageStats(gh);
    if (!medals.isConnected) return;
    medals.innerHTML = stats ? renderLangMedalStrip(stats.langs, stats.repoCounts) : '';
  } finally {
    if (medals.isConnected) delete medals.dataset.hydrating;
  }
}

// Same idea for the GitHub contributions heatmap: render the empty grid
// inline (renderProfile already does that), then fill it in once the
// API answers. Cached for an hour so revisits are instant.
export async function hydrateProfileActivity(handle) {
  const u = getUser(handle);
  const gh = u?.github?.handle;
  if (!gh) return;
  const slot = document.querySelector('#profile-activity-' + u.handle + ' .profile-activity__graph');
  if (!slot) return;
  // Same per-slot dedupe pattern as hydrateProfileBadges — survives
  // re-renders correctly because the dataset attaches to the DOM
  // element, not to the handle.
  if (slot.dataset.hydrating === '1') return;
  slot.dataset.hydrating = '1';
  try {
    const cached = cachedContributions(gh);
    if (!cached) {
      const counts = await fetchContributions(gh);
      if (!counts) return;
    }
    const counts = cachedContributions(gh);
    if (counts) slot.innerHTML = renderGrass(counts);
  } finally {
    if (slot.isConnected) delete slot.dataset.hydrating;
  }
}
