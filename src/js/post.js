// Shared rendering for a single post card (used by home & profile timelines).
import { renderFileBadge } from './file-size-viz.js';
import { statusBadge }     from './status-badges.js';
import { getUser, relTime } from './data.js';
import { url }              from './router.js';
import { icon }             from './icons.js';
import { isLiked, likeCount, isReposted, isBookmarked } from './interactions.js';
import { currentUser }      from './auth.js';
import { renderAvatar }     from './avatar.js';
import { isNearSpotSync, getRadius } from './geo-gate.js';
import { isDevMode }        from './dev-mode.js';

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// Very small inline-markdown pass over already-escaped body:
//   `code`  → <code>code</code>
// (Backticks are common in seed posts; treating them as code reads much
// nicer than printing them literally.)
function inlineFormat(escaped) {
  return escaped.replace(/`([^`\n]+)`/g, '<code>$1</code>');
}

function files(list) {
  if (!list || !list.length) return '';
  return '<div class="post__meta">' + list.map(([n, b]) => renderFileBadge(n, b)).join(' ') + '</div>';
}

function commit(c) {
  if (!c) return '';
  return (
    '<div class="post__commit">' +
      '<div class="commit-head">' +
        '<span class="commit-sha">' + escape(c.sha) + '</span>' +
        '<span class="commit-repo">' + escape(c.repo) + '</span>' +
        '<span class="commit-stat">' +
          '<span class="add">+' + c.add + '</span>' +
          '<span class="del">−' + c.del + '</span>' +
        '</span>' +
      '</div>' +
      '<div class="commit-body">' + escape(c.msg) + '</div>' +
    '</div>'
  );
}

function timeText(p) {
  if (p.createdAt) return relTime(p.createdAt);
  return p.time || '';
}

// Build a Google Maps URL that, when opened, shows the building name
// in the search box instead of raw N/E coordinates. Priority order:
//   1. label   ("東京都立桜町高等学校") — text search, Maps resolves to the place
//   2. address ("世田谷区用賀…")        — same, but less specific
//   3. lat/lng                          — last-resort coordinate pin
// In (1)/(2) we still append the coords via the `/@<lat>,<lng>,17z`
// suffix so Maps centres on the exact spot the user picked, even when
// the name lookup matches multiple branches (e.g. a chain store).
function gmapsUrl(spot) {
  const lat = Number(spot.lat), lng = Number(spot.lng);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
  const text = (spot.label || spot.address || '').trim();
  if (text) {
    const q = encodeURIComponent(text);
    return hasCoords
      ? 'https://www.google.com/maps/search/' + q + '/@' + lat + ',' + lng + ',17z'
      : 'https://www.google.com/maps/search/?api=1&query=' + q;
  }
  if (hasCoords) return 'https://www.google.com/maps?q=' + lat + ',' + lng;
  return 'https://www.google.com/maps';
}

function spotChip(spot) {
  if (!spot) return '';
  const pinIcon = icon('pin', { size: 12, className: 'icon--inline' });
  if (typeof spot === 'object') {
    const label = spot.label || (Number(spot.lat).toFixed(4) + ', ' + Number(spot.lng).toFixed(4));
    const gmaps = gmapsUrl(spot);
    const title = spot.address ? 'Google Maps で開く — ' + spot.address : 'Google Maps で開く';
    return '<a class="spot-chip" href="' + gmaps + '" target="_blank" rel="noopener" title="' + escape(title) + '">' +
      pinIcon + escape(label) + '</a>';
  }
  return '<span class="spot-chip">' + pinIcon + escape(spot) + '</span>';
}

// Address line under the post body: includes 〒postcode and 番地 when known.
function spotAddress(spot) {
  if (!spot || typeof spot !== 'object') return '';
  if (!spot.address) return '';
  const d = spot.addressDetails || {};
  const hnNote = d.houseNumber
    ? ''
    : ' <span class="post__addr-warn" title="OpenStreetMap に番地データがありません">(番地情報なし)</span>';
  return '<div class="post__addr">' +
    icon('pin', { size: 12, className: 'icon--inline' }) +
    escape(spot.address) + hnNote +
  '</div>';
}

// Render an embedded quoted-post card. Used when `p.quoteOf` is set
// (the parent post fetched the quoted post in a 2nd round trip).
// Compact, non-interactive — clicking the card navigates to the quoted
// post's own detail page so users can interact there.
function quoteCard(q) {
  if (!q) return '';
  const u = q.author || { name: q.authorHandle || '?', handle: q.authorHandle || '?', avatar: '?' };
  return (
    '<a class="quote-card" href="' + url('/post/' + q.id) + '">' +
      '<div class="quote-card__head">' +
        '<span class="quote-card__name">' + escape(u.name) + '</span>' +
        '<span class="quote-card__handle">@' + escape(u.handle) + '</span>' +
        '<span class="quote-card__time">· ' + escape(relTime(q.createdAt || Date.now())) + '</span>' +
      '</div>' +
      '<div class="quote-card__body">' + escape((q.body || '').slice(0, 240)) +
        ((q.body || '').length > 240 ? '…' : '') +
      '</div>' +
    '</a>'
  );
}

// "Activity / 誰がしたか" shortcut for the post author. Sends them to
// /post/<id>/analytics so they can see who liked / commented / reposted
// / bookmarked / quoted their post.
function analyticsLink(postId) {
  return '<a class="act act--analytics" title="アクティビティを見る" href="' + url('/post/' + postId + '/analytics') + '">' +
    icon('chart', { size: 16 }) + '</a>';
}

// Spot-tagged posts have their body gated by location: the viewer
// has to be within geo-gate's radius of the pin to read it. Three
// bypasses, in priority order:
//   1. Viewer is the post author — see your own posts anywhere.
//   2. Dev mode is on — admins / debug have full access.
//   3. Post has no spot — nothing to gate against, always readable.
function isLockedBySpot(p, me) {
  if (!p.spot || p.spot.lat == null || p.spot.lng == null) return false;
  if (me && p.authorHandle === me.handle) return false;
  if (isDevMode()) return false;
  return isNearSpotSync(p.spot.lat, p.spot.lng) !== true;
}

function lockedBanner() {
  return (
    '<div class="post__locked">' +
      icon('pin', { size: 14, className: 'icon--inline' }) +
      'ここから半径 ' + getRadius() + ' m 以内に来ると中身が読めます' +
    '</div>'
  );
}

export function renderPost(p) {
  const u = getUser(p.authorHandle) || { name: p.authorHandle, avatar: '?', handle: p.authorHandle };
  const a = p.actions || {};
  const profileUrl = url('/' + u.handle);
  const me = currentUser();
  const liked      = me && isLiked(p.id);
  const reposted   = me && isReposted(p.id);
  const bookmarked = me && isBookmarked(p.id);
  const likes = likeCount(p.id);
  const isOwn  = me && p.authorHandle === me.handle;
  const locked = isLockedBySpot(p, me);
  return (
    '<article class="post' + (locked ? ' post--locked' : '') + '" data-post-id="' + escape(p.id) + '">' +
      renderAvatar(u, { tag: 'a', href: profileUrl }) +
      '<div class="post__main">' +
        '<div class="post__head">' +
          '<a class="post__name" href="' + profileUrl + '">' + escape(u.name) + '</a>' +
          '<a class="post__handle" href="' + profileUrl + '">@' + escape(u.handle) + '</a>' +
          '<span class="post__sep">·</span>' +
          '<span class="post__time">' + escape(timeText(p)) + '</span>' +
          (p.spot ? '<span class="post__sep">·</span>' + spotChip(p.spot) : '') +
          (p.status ? ' ' + statusBadge(p.status) : '') +
        '</div>' +
        (locked
          ? lockedBanner() + spotAddress(p.spot)
          : (
            '<div class="post__body">' + inlineFormat(escape(p.body)) + '</div>' +
            spotAddress(p.spot) +
            (p.githubLink
              ? '<div class="post__meta"><a class="post__link" href="' + escape(p.githubLink) + '" target="_blank" rel="noopener">' +
                icon('github', { size: 14, fill: true, className: 'icon--inline' }) + escape(p.githubLink) + '</a></div>'
              : '') +
            files(p.files) +
            commit(p.commit) +
            quoteCard(p.quoteOf)
          )
        ) +
        '<div class="post__actions">' +
          '<a class="act act--reply" title="コメント" href="' + url('/post/' + p.id) + '">' + icon('reply', { size: 16 }) + '<span>' + (a.replies || 0) + '</span></a>' +
          '<button class="act act--fork' + (reposted ? ' is-on' : '') + '" title="リポスト / 引用" data-post-id="' + escape(p.id) + '">' +
            icon('fork',  { size: 16 }) + '<span>' + (a.forks || 0) + '</span></button>' +
          '<button class="act act--star' + (bookmarked ? ' is-on' : '') + '" title="保存" data-post-id="' + escape(p.id) + '">' +
            icon('star',  { size: 16 }) + '<span>' + (a.stars || 0) + '</span></button>' +
          '<button class="act act--like' + (liked ? ' is-liked' : '') + '" title="いいね" data-post-id="' + escape(p.id) + '">' +
            icon('heart', { size: 16 }) + '<span>'  + likes + '</span></button>' +
          '<button class="act act--share" title="共有" data-post-id="' + escape(p.id) + '">' + icon('share', { size: 16 }) + '</button>' +
          (isOwn ? analyticsLink(p.id) : '') +
          (isOwn
            ? '<button class="act act--delete" title="この投稿を削除">' + icon('trash', { size: 16 }) + '</button>'
            : '<button class="act act--report" title="report">' + icon('flag', { size: 16 }) + '</button>') +
        '</div>' +
      '</div>' +
    '</article>'
  );
}
