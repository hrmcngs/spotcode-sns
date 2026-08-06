// /event/<connpass-id> view. Aggregates every spotcode-sns post
// tagged with the given connpass event URL, and displays the event's
// title / date / venue at the top when connpass's public API returns
// metadata (CORS-allowing; falls back to "connpass #<id>" otherwise).

import { renderPost } from '../post.js';
import { url, currentPath } from '../router.js';
import { postsByEventId, cachedPosts } from '../data.js';
import { fetchEventMeta, cachedEventMeta, formatEventStart } from '../connpass.js';
import { renderTimelineSkeleton } from '../skeleton.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { withTimeout } from '../net-utils.js';
import { hydratePostLikes, hydrateRepostsMine, hydrateBookmarksMine, hydratePolls } from '../interactions.js';
import { hydrateQuotedPosts } from '../data.js';

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// The header block: `[← Back]  connpass event title  · date · venue`.
// Painted twice — once inline from whatever `cachedEventMeta` has
// (may be null on first visit), then again after `fetchEventMeta`
// resolves. Structure kept stable so a replaceWith() doesn't reshuffle
// the sticky area.
function renderEventHead(eventId, meta) {
  const title  = (meta && meta.title)  || 'connpass #' + eventId;
  const when   = (meta && meta.startedAt) ? formatEventStart(meta.startedAt) : '';
  const place  = (meta && (meta.place || meta.address)) || '';
  const catchp = (meta && meta.catch) || '';
  const url    = (meta && meta.url) || ('https://connpass.com/event/' + eventId + '/');
  return (
    '<div class="event-head" id="event-head" data-event-id="' + escapeHtml(eventId) + '">' +
      '<div class="event-head__row">' +
        icon('calendar', { size: 18, className: 'icon--inline' }) +
        '<h2 class="event-head__title">' + escapeHtml(title) + '</h2>' +
        '<a class="event-head__ext" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" ' +
            'title="connpass で開く">↗</a>' +
      '</div>' +
      (when || place
        ? '<div class="event-head__meta">' +
            (when  ? '<span>' + escapeHtml(when)  + '</span>' : '') +
            (place ? '<span>' + escapeHtml(place) + '</span>' : '') +
          '</div>'
        : '') +
      (catchp ? '<p class="event-head__catch">' + escapeHtml(catchp) + '</p>' : '') +
    '</div>'
  );
}

export function renderEvent(eventId) {
  const meta = cachedEventMeta(eventId);
  const cached = cachedPosts('event:' + eventId);
  const initial = (cached && cached.length)
    ? cached.map(renderPost).join('')
    : renderTimelineSkeleton(3);
  return (
    renderEventHead(eventId, meta) +
    '<div id="event-posts">' + initial + '</div>'
  );
}

// Fetch the event metadata + posts in parallel. Both are best-effort:
// meta may be blocked by connpass CORS; posts may be empty when nobody
// has tagged this event yet.
export async function hydrateEvent(eventId) {
  if (!eventId) return;
  const myPath = '/event/' + eventId;
  const stillHere = () => currentPath() === myPath;

  // Meta first (fire-and-forget; no timeout — the fetcher itself
  // wraps its own network path and caches the null-result).
  fetchEventMeta(eventId).then((meta) => {
    if (!stillHere()) return;
    const head = document.getElementById('event-head');
    if (!head) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = renderEventHead(eventId, meta);
    if (wrap.firstElementChild) head.replaceWith(wrap.firstElementChild);
  }).catch(() => {});

  // Posts.
  const slot = () => document.getElementById('event-posts');
  if (!slot()) return;
  let posts;
  try {
    posts = await withTimeout(postsByEventId(eventId), 15000, 'event:' + eventId);
  } catch (err) {
    if (!stillHere()) return;
    const list = slot();
    if (list) {
      list.innerHTML =
        '<div class="stub">' +
          '<p class="stub__sub">' + t('event.error') + ': ' + escapeHtml(err.message || '') + '</p>' +
          '<button class="btn btn--ghost btn--sm" data-event-retry="' + escapeHtml(eventId) + '">再試行</button>' +
        '</div>';
    }
    return;
  }
  if (!stillHere()) return;
  const list = slot();
  if (!list) return;
  if (!posts.length) {
    list.innerHTML =
      '<div class="stub">' +
        '<h2 class="stub__title">' + t('event.empty.title') + '</h2>' +
        '<p class="stub__sub">' + t('event.empty.sub') + '</p>' +
      '</div>';
    return;
  }
  list.innerHTML = posts.map(renderPost).join('');

  // Standard post-list hydration (likes / reposts / bookmarks / polls
  // / quoted-post previews) so counts + toggle state light up.
  const ids = posts.map((p) => p.id);
  try {
    await Promise.all([
      hydratePostLikes(ids),
      hydrateRepostsMine(ids),
      hydrateBookmarksMine(ids),
      hydrateQuotedPosts(posts),
    ]);
  } catch (err) {
    console.warn('event hydrate batch', err);
  }
  if (!stillHere()) return;
  list.innerHTML = posts.map(renderPost).join('');
  hydratePolls(posts).catch(() => {});
}
