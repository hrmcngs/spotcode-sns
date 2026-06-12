// Shared rendering for a single post card (used by home & profile timelines).
import { renderFileBadge } from './file-size-viz.js';
import { statusBadge }     from './status-badges.js';
import { getUser, relTime } from './data.js';
import { url }              from './router.js';
import { icon }             from './icons.js';
import { isLiked, likeCount } from './interactions.js';
import { currentUser }      from './auth.js';

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

function spotChip(spot) {
  if (!spot) return '';
  const pinIcon = icon('pin', { size: 12, className: 'icon--inline' });
  if (typeof spot === 'object') {
    const label = spot.label || (Number(spot.lat).toFixed(4) + ', ' + Number(spot.lng).toFixed(4));
    const gmaps = 'https://www.google.com/maps?q=' + spot.lat + ',' + spot.lng;
    return '<a class="spot-chip" href="' + gmaps + '" target="_blank" rel="noopener" title="Google Maps で開く">' +
      pinIcon + escape(label) + '</a>';
  }
  return '<span class="spot-chip">' + pinIcon + escape(spot) + '</span>';
}

export function renderPost(p) {
  const u = getUser(p.authorHandle) || { name: p.authorHandle, avatar: '?', handle: p.authorHandle };
  const a = p.actions || {};
  const profileUrl = url('/' + u.handle);
  const me = currentUser();
  const liked = me && isLiked(p.id, me.handle);
  const likes = (a.likes || 0) + likeCount(p.id);
  return (
    '<article class="post" data-post-id="' + escape(p.id) + '" data-base-likes="' + (a.likes || 0) + '">' +
      '<a class="avatar" href="' + profileUrl + '">' + escape(u.avatar) + '</a>' +
      '<div class="post__main">' +
        '<div class="post__head">' +
          '<a class="post__name" href="' + profileUrl + '">' + escape(u.name) + '</a>' +
          '<a class="post__handle" href="' + profileUrl + '">@' + escape(u.handle) + '</a>' +
          '<span class="post__sep">·</span>' +
          '<span class="post__time">' + escape(timeText(p)) + '</span>' +
          (p.spot ? '<span class="post__sep">·</span>' + spotChip(p.spot) : '') +
          (p.status ? ' ' + statusBadge(p.status) : '') +
        '</div>' +
        '<div class="post__body">' + inlineFormat(escape(p.body)) + '</div>' +
        (p.githubLink
          ? '<div class="post__meta"><a class="post__link" href="' + escape(p.githubLink) + '" target="_blank" rel="noopener">' +
            icon('github', { size: 14, fill: true, className: 'icon--inline' }) + escape(p.githubLink) + '</a></div>'
          : '') +
        files(p.files) +
        commit(p.commit) +
        '<div class="post__actions">' +
          '<button class="act act--reply" title="reply">' + icon('reply', { size: 16 }) + '<span>' + (a.replies || 0) + '</span></button>' +
          '<button class="act act--fork"  title="fork">'  + icon('fork',  { size: 16 }) + '<span>' + (a.forks   || 0) + '</span></button>' +
          '<button class="act act--star"  title="star">'  + icon('star',  { size: 16 }) + '<span>' + (a.stars   || 0) + '</span></button>' +
          '<button class="act act--like' + (liked ? ' is-liked' : '') + '" title="like">'  + icon('heart', { size: 16 }) + '<span>'  + likes + '</span></button>' +
          '<button class="act act--share" title="share">' + icon('share', { size: 16 }) + '</button>' +
          '<button class="act act--report" title="report">' + icon('flag', { size: 16 }) + '</button>' +
        '</div>' +
      '</div>' +
    '</article>'
  );
}
