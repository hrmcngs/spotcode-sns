// GitHub "tasks" for the profile page.
//
// A "task" here is a public open GitHub issue authored by the user
// (PRs excluded via type:issue). The Search API returns count +
// items in one call — much cheaper than iterating over the user's
// repos and asking each for issues. All the data we surface is
// already public on github.com; no auth required.
//
// Rate limit: unauth Search API is 10 requests / minute per IP.
// Cache aggressively (1h TTL) and share the app-wide cooldown flag
// with language-stats.js so a 403 in one place backs off the other.

import { fetchJson, isRateLimited } from './language-stats.js';

const CACHE_KEY = 'spotcode:gh-tasks:v1';
const TTL_MS    = 60 * 60 * 1000;   // 1 h
const MAX_ITEMS = 30;                // hard cap so a mega-issuer doesn't blow storage

// GitHub Search Issues doesn't return repo_full_name directly; we
// derive it from repository_url which is
// "https://api.github.com/repos/<owner>/<repo>".
function repoFullNameFromRepoUrl(u) {
  if (!u) return '';
  const m = String(u).match(/\/repos\/([^/]+\/[^/?#]+)/);
  return m ? m[1] : '';
}

// Parse a "due" / "期限" line out of the issue body. Supports both
// English and Japanese keywords, either after a bold marker (**due**)
// or plain (`Due:`). Accepts YYYY-MM-DD, YYYY/MM/DD, YYYY年MM月DD日,
// and optional time (HH:MM). Returns the timestamp in ms or null.
//
// Format guide is at docs/task-issue-template.md — keep the regex
// permissive enough that a user copying the template variants above
// still parses.
const DUE_KEYWORDS = '(?:due|deadline|by|期限|締切|締め切り|しめきり|しめ切り|しめきり)';
const DUE_RE = new RegExp(
  '(?:\\*\\*)?\\s*' + DUE_KEYWORDS + '\\s*(?:\\*\\*)?\\s*[:：]?\\s*' +
    '(\\d{4})[-/年]\\s*(\\d{1,2})[-/月]\\s*(\\d{1,2})日?' +
    '(?:[T\\s]+(\\d{1,2}):(\\d{2}))?',
  'i',
);

export function parseDue(body) {
  if (!body) return null;
  const m = String(body).match(DUE_RE);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = m[4] != null ? Number(m[4]) : 23;   // default to end-of-day so
  const mi = m[5] != null ? Number(m[5]) : 59;  // date-only entries aren't
                                                 // marked "overdue" at 00:01
  if (!y || !mo || !d) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d, h, mi);
  if (isNaN(dt.getTime())) return null;
  return {
    ts:    dt.getTime(),
    // Preserve whether the user wrote a time. Downstream can pick
    // "YYYY-MM-DD HH:MM" vs "YYYY-MM-DD" based on this.
    hasTime: m[4] != null,
    // Keep the raw match so a UI could highlight the source string
    // in the body if we ever want that.
    raw:   m[0],
  };
}

function shape(item) {
  const body = item.body || '';
  const due = parseDue(body);
  return {
    id:        item.id,
    number:    item.number,
    title:     item.title || '',
    url:       item.html_url,
    body,
    createdAt: item.created_at ? new Date(item.created_at).getTime() : 0,
    comments:  item.comments || 0,
    repo:      repoFullNameFromRepoUrl(item.repository_url),
    labels:    (item.labels || []).map((l) => l.name || '').filter(Boolean),
    dueTs:     due ? due.ts : null,
    dueHasTime: !!(due && due.hasTime),
  };
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); }
  catch { return {}; }
}
function writeCache(o) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(o)); }
  catch {}
}

// Sync accessor for the render path — reads the cached snapshot
// so the profile card can paint SOMETHING before the network call
// resolves. Returns null on cache miss / stale.
export function cachedTasks(ghHandle) {
  if (!ghHandle) return null;
  const all = readCache();
  const entry = all[ghHandle.toLowerCase()];
  if (!entry) return null;
  // Stale-while-revalidate: an older issue snapshot is much more useful
  // than a loading card while GitHub Search is slow. fetchTasks() still
  // refreshes it in the background on every profile hydration.
  return entry;
}

// Fetch open issues authored by `ghHandle` across all public repos
// via the Search API. Returns { totalCount, items[] }. On rate limit
// or fetch error, returns whatever's cached (possibly stale) so the
// card degrades gracefully rather than showing an error every render.
export async function fetchTasks(ghHandle) {
  if (!ghHandle) return null;
  if (isRateLimited()) return cachedTasks(ghHandle);

  // Search qualifiers:
  //   author:<handle>  — issues opened by this user
  //   type:issue       — exclude PRs (github treats PRs as issues by default)
  //   state:open       — hide closed
  //   is:public        — hide private repos (would 404 anyway for anon fetches
  //                       but the qualifier keeps the search index small)
  // sort=created + order=desc → newest first, so the top of the list
  // is what the viewer is most likely to care about.
  const q = 'author:' + encodeURIComponent(ghHandle)
          + '+type:issue+state:open+is:public';
  const url = 'https://api.github.com/search/issues?q=' + q +
              '&sort=created&order=desc&per_page=' + MAX_ITEMS;
  let raw;
  try { raw = await fetchJson(url, 6000); }
  catch { return cachedTasks(ghHandle); }
  if (!raw) return cachedTasks(ghHandle);

  const items = (raw.items || []).map(shape);
  // Sort so the most-urgent issues surface first:
  //   1. Items WITH a parsed due date, ordered earliest → latest
  //      (overdue is naturally at the top since its ts is in the past)
  //   2. Items WITHOUT a due date, ordered by createdAt desc
  //      (mirrors the Search API's default sort)
  items.sort((a, b) => {
    if (a.dueTs != null && b.dueTs != null) return a.dueTs - b.dueTs;
    if (a.dueTs != null) return -1;
    if (b.dueTs != null) return 1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
  // The Search API caps total_count at 1000 for anonymous callers,
  // but for our audience (individual dev accounts) any real number
  // is far under that ceiling. Use it verbatim.
  const entry = {
    at: Date.now(),
    totalCount: raw.total_count || 0,
    items,
  };
  const all = readCache();
  all[ghHandle.toLowerCase()] = entry;
  writeCache(all);
  return entry;
}
