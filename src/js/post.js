// Shared rendering for a single post card (used by home & profile timelines).
import { renderFileBadge } from './file-size-viz.js';
import { statusBadge }     from './status-badges.js';
import { getUser, relTime } from './data.js';
import { url }              from './router.js';
import { icon }             from './icons.js';

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

export function renderPost(p) {
  const u = getUser(p.authorHandle) || { name: p.authorHandle, avatar: '?', handle: p.authorHandle };
  const a = p.actions || {};
  const profileUrl = url('/' + u.handle);
  return (
    '<article class="post" data-post-id="' + escape(p.id) + '">' +
      '<a class="avatar" href="' + profileUrl + '">' + escape(u.avatar) + '</a>' +
      '<div class="post__main">' +
        '<div class="post__head">' +
          '<a class="post__name" href="' + profileUrl + '">' + escape(u.name) + '</a>' +
          '<a class="post__handle" href="' + profileUrl + '">@' + escape(u.handle) + '</a>' +
          '<span class="post__sep">·</span>' +
          '<span class="post__time">' + escape(timeText(p)) + '</span>' +
          '<span class="post__sep">·</span>' +
          '<span class="spot-chip">' + icon('pin', { size: 12, className: 'icon--inline' }) + escape(p.spot) + '</span>' +
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
          '<button class="act act--like"  title="like">'  + icon('heart', { size: 16 }) + '<span>'  + (a.likes   || 0) + '</span></button>' +
          '<button class="act act--share" title="share">' + icon('share', { size: 16 }) + '</button>' +
        '</div>' +
      '</div>' +
    '</article>'
  );
}
