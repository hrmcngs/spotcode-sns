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
import { isDevMode, isOperator } from './dev-mode.js';
import { parseConnpassUrl, cachedEventMeta, formatEventStart } from './connpass.js';
import { parseGithubLink } from './gh-link.js';
import { maskHandle, maskName, maskMentionsInText } from './privacy-mode.js';
import { t }                from './i18n.js';
import { safeLinkUrl, safeImageUrl } from './safe-url.js';

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// Re-export the markdown renderer as `inlineFormat` for back-compat
// with comment / quote callers that still want the lightweight pass.
// Post bodies use the full block renderer below.
export { renderMarkdown as inlineFormat } from './markdown.js';
import { renderMarkdown } from './markdown.js';

function files(list) {
  if (!list || !list.length) return '';
  return '<div class="post__meta">' + list.map(([n, b]) => renderFileBadge(n, b)).join(' ') + '</div>';
}

// Composer-attached photos. Up to PHOTO_CAP (4) entries; layout is a
// 1/2/2x2 grid depending on count so portrait/landscape mixes still
// read cleanly without each photo eating a full row.
function photos(list) {
  if (!list || !list.length) return '';
  // Validate every src against the image allowlist (data:image/* or
  // http(s)). The earlier version used safeLinkUrl which doesn't
  // accept data: URLs, so every photo captured via the camera came
  // back from the DB as a `data:image/jpeg;base64,…` string and got
  // silently dropped — the preview showed it but the feed never did.
  const safe = list.map(safeImageUrl).filter(Boolean);
  if (!safe.length) return '';
  const cls = 'post__photos post__photos--' + Math.min(4, safe.length);
  return '<div class="' + cls + '">' + safe.map((src) => (
    '<img class="post__photo" src="' + escape(src) + '" alt="" loading="lazy" decoding="async">'
  )).join('') + '</div>';
}

// Poll card. Renders the question + options. Voting state and tallies
// are hydrated asynchronously by hydratePolls() — at first paint each
// option shows as a clickable button with no counts, and the bars +
// percentages swap in once pollTally() resolves.
function poll(p) {
  if (!p || !Array.isArray(p.options) || p.options.length < 2) return '';
  const remaining = p.deadlineAt - Date.now();
  const closed = remaining <= 0;
  const deadlineText = closed ? '投票終了'
    : remaining < 60_000 ? 'まもなく終了'
    : remaining < 3600_000 ? 'あと ' + Math.floor(remaining / 60_000) + ' 分'
    : remaining < 86400_000 ? 'あと ' + Math.floor(remaining / 3600_000) + ' 時間'
    : 'あと ' + Math.floor(remaining / 86400_000) + ' 日';
  return (
    '<div class="poll" data-poll-closed="' + (closed ? '1' : '0') + '">' +
      '<div class="poll__q">' + escape(p.question || '') + '</div>' +
      '<div class="poll__opts">' +
        p.options.map((opt, i) =>
          '<button type="button" class="poll__opt" data-poll-idx="' + i +
            '"' + (closed ? ' disabled' : '') + '>' +
            '<span class="poll__opt-bar"></span>' +
            '<span class="poll__opt-text">' + escape(opt) + '</span>' +
            '<span class="poll__opt-pct"></span>' +
          '</button>'
        ).join('') +
      '</div>' +
      '<div class="poll__meta">' +
        '<span class="poll__total">0 票</span>' +
        '<span class="poll__sep">·</span>' +
        '<span class="poll__deadline">' + deadlineText + '</span>' +
      '</div>' +
    '</div>'
  );
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
    return '<a class="spot-chip" href="' + escape(gmaps) + '" target="_blank" rel="noopener noreferrer" title="' + escape(title) + '">' +
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
  const displayName   = maskName(u.handle, u.name);
  const displayHandle = maskHandle(u.handle);
  const body = (q.body || '').slice(0, 240);
  return (
    '<a class="quote-card" href="' + url('/post/' + q.id) + '">' +
      '<div class="quote-card__head">' +
        '<span class="quote-card__name">' + escape(displayName) + '</span>' +
        '<span class="quote-card__handle">@' + escape(displayHandle) + '</span>' +
        '<span class="quote-card__time">· ' + escape(relTime(q.createdAt || Date.now())) + '</span>' +
      '</div>' +
      '<div class="quote-card__body">' + escape(maskMentionsInText(body)) +
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
  // Operators (and admins) can read any post regardless of distance
  // — they need to be able to evaluate reports without travelling.
  if (isOperator()) return false;
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

// Tiny lookup so we can stamp a small hint badge next to restricted
// posts. The actual gating is enforced by Stage 18 RLS — by the time
// a row arrives at this renderer it has already been allow-listed
// for the viewer, so this is purely informational.
//
// Icon names match icons.js; the label is i18n-keyed.
const VIS_HINT = {
  public:    null,
  mutuals:   { ico: 'fork',        labelKey: 'post.vis.mutuals' },
  following: { ico: 'arrow_right', labelKey: 'post.vis.following' },
  friends:   { ico: 'heart',       labelKey: 'post.vis.friends' },
  org:       { ico: 'building',    labelKey: 'post.vis.org' },
  restricted:{ ico: 'lock',        labelKey: 'post.vis.restricted' },
};

export function renderPost(p) {
  const u = getUser(p.authorHandle) || { name: p.authorHandle, avatar: '?', handle: p.authorHandle };
  const a = p.actions || {};
  const profileUrl = url('/' + u.handle);
  const me = currentUser();
  const visHint = VIS_HINT[p.visibility] || null;
  const liked      = me && isLiked(p.id);
  const reposted   = me && isReposted(p.id);
  const bookmarked = me && isBookmarked(p.id);
  const likes = likeCount(p.id);
  const isOwn  = me && p.authorHandle === me.handle;
  // Operators (and the admin) can delete anyone's post — moderation
  // duty. The backend still enforces RLS via the is_admin policy on
  // posts; if the operator account doesn't have the matching
  // server-side flag, the call surfaces the existing "削除権限が
  // ありません" alert instead of silently no-op.
  const canDelete = isOwn || isOperator();
  // Editing is author-only — dev mode acts as a moderator and gets the
  // delete (destructive, irreversible) hammer, but rewriting someone
  // else's words is a different threat model so we don't expose it.
  const canEdit = isOwn;
  const wasEdited = p.editedAt && p.editedAt - (p.createdAt || 0) > 2000;
  const locked = isLockedBySpot(p, me);
  const displayName   = maskName(u.handle, u.name);
  const displayHandle = maskHandle(u.handle);
  return (
    '<article class="post' + (locked ? ' post--locked' : '') + '" data-post-id="' + escape(p.id) + '">' +
      renderAvatar(u, { tag: 'a', href: profileUrl }) +
      '<div class="post__main">' +
        '<div class="post__head">' +
          '<a class="post__name" href="' + profileUrl + '">' + escape(displayName) + '</a>' +
          '<a class="post__handle" href="' + profileUrl + '">@' + escape(displayHandle) + '</a>' +
          '<span class="post__sep">·</span>' +
          '<span class="post__time">' + escape(timeText(p)) + '</span>' +
          (wasEdited ? '<span class="post__edited" title="' + escape(new Date(p.editedAt).toLocaleString()) + '">（編集済み）</span>' : '') +
          (p.spot ? '<span class="post__sep">·</span>' + spotChip(p.spot) : '') +
          (p.kind === 'idea'
            ? ' <span class="post__kind post__kind--idea" title="' + escape(t('kind.idea.title')) + '">' +
                icon('spark', { size: 12, className: 'icon--inline' }) + escape(t('kind.idea')) +
              '</span>'
            : '') +
          (visHint
            ? ' <span class="post__vis" title="' + escape(t(visHint.labelKey)) + '">' +
                icon(visHint.ico, { size: 12, className: 'icon--inline' }) + escape(t(visHint.labelKey)) +
              '</span>'
            : '') +
          (p.status ? ' ' + statusBadge(p.status) : '') +
        '</div>' +
        (locked
          ? lockedBanner() + spotAddress(p.spot)
          : (
            '<div class="post__body' + (canEdit ? ' post__body--editable-tasks' : '') + '">' +
              renderMarkdown(escape(maskMentionsInText(p.body)), { editable: canEdit }) +
            '</div>' +
            spotAddress(p.spot) +
            // Author-supplied URL — validated against the safeLinkUrl
            // allowlist so a `javascript:` scheme can't slip past.
            // Render the LABEL as a compact `owner/repo` / `owner/repo :
            // <path>` string parsed from the URL rather than the raw
            // URL. Long GitHub links used to eat two full lines of the
            // card; the tooltip still carries the full URL for
            // copy-paste. Non-GitHub links (rare — the input is
            // labelled "GitHub link") fall back to the URL's host +
            // pathname without the scheme.
            ((() => {
              const safe = safeLinkUrl(p.githubLink);
              if (!safe) return '';
              let label = safe;
              const gh = parseGithubLink(safe);
              if (gh) {
                label = gh.owner + '/' + gh.repo;
                if (gh.path) label += ' : ' + gh.path;
              } else {
                try {
                  const u = new URL(safe);
                  label = (u.host + u.pathname).replace(/\/$/, '');
                } catch {}
              }
              return '<div class="post__meta"><a class="post__link" href="' + escape(safe) + '" target="_blank" rel="noopener noreferrer" title="' + escape(safe) + '">' +
                icon('repo', { size: 14, className: 'icon--inline' }) + escape(label) + '</a></div>';
            })()) +
            // connpass event chip. The link points at the in-app
            // /event/<id> page (so a click aggregates all posts about
            // the same event); a small ↗ label + the fetched title
            // (cached via connpass API) is shown when available.
            ((() => {
              const parsed = parseConnpassUrl(p.eventUrl);
              if (!parsed) return '';
              const meta = cachedEventMeta(parsed.id);
              const label = meta && meta.title ? meta.title : ('connpass #' + parsed.id);
              const when  = meta && meta.startedAt ? formatEventStart(meta.startedAt) : '';
              return '<div class="post__meta">' +
                '<a class="post__link post__link--event" href="' + url('/event/' + parsed.id) + '">' +
                  icon('calendar', { size: 14, className: 'icon--inline' }) +
                  escape(label) +
                  (when ? ' <span class="post__link-when">· ' + escape(when) + '</span>' : '') +
                '</a>' +
              '</div>';
            })()) +
            photos(p.photos) +
            poll(p.poll) +
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
          (canEdit
            ? '<button class="act act--edit" title="この投稿を編集">' + icon('pencil', { size: 16 }) + '</button>'
            : '') +
          (canDelete
            ? '<button class="act act--delete" title="' + (isOwn ? 'この投稿を削除' : '他のユーザーの投稿を削除（dev）') + '"' +
                (isOwn ? '' : ' data-foreign-delete="1"') + '>' +
              icon('trash', { size: 16 }) + '</button>'
            : '<button class="act act--report" title="report">' + icon('flag', { size: 16 }) + '</button>') +
        '</div>' +
      '</div>' +
    '</article>'
  );
}
