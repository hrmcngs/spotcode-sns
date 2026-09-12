// Profile tasks: open Issues in explicitly selected repositories, qualified
// by commit history or a Pull Request referencing the specific Issue.
import { fetchJson, isRateLimited, hasGithubApiToken } from './language-stats.js';
import { currentUser } from './auth.js';
import { selectedTaskRepos } from './display-prefs.js';

const CACHE_KEY = 'spotcode:gh-tasks:v3';
const TTL_MS    = 60 * 60 * 1000;   // 1 h
const pending = new Map();

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
const DUE_KEYWORDS = '(?:due|deadline|by|期限|提出期限|提出日|締切|締め切り|しめきり|しめ切り|しめきり)';
const DUE_RE = new RegExp(
  '(?:\\*\\*)?\\s*' + DUE_KEYWORDS + '\\s*[:：]?\\s*(?:\\*\\*)?\\s*[:：]?\\s*' +
    '(?:(\\d{4})[-/年]\\s*)?(\\d{1,2})[-/月]\\s*(\\d{1,2})日?' +
    '(?:\\s*\\([^)]*\\))?(?:[T\\s]+(\\d{1,2}):(\\d{2}))?',
  'i',
);

export function parseDue(body) {
  if (!body) return null;
  const m = String(body).match(DUE_RE);
  if (!m) return null;
  const y = m[1] ? Number(m[1]) : new Date().getFullYear();
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

function hiddenByIssueTemplate(item) {
  const body = String(item?.body || '');
  const hiddenLabel = (item?.labels || []).some((label) =>
    ['spotcode非表示', 'spotcode-hidden'].includes(String(label?.name || '').toLowerCase())
  );
  return hiddenLabel || /(?:\*\*)?\s*spotcode\s*表示\s*[:：]?\s*(?:\*\*)?\s*[:：]?\s*(?:しない|非表示|off|false|no)(?:\s|$)/im.test(body);
}

function scope(handle, includePrivate) {
  const owner = currentUser()?.id || '';
  const repos = [...new Set(selectedTaskRepos().map(repo => String(repo).toLowerCase())
    .filter(repo => /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repo)))].sort();
  return { owner, repos, key: JSON.stringify([owner, handle.toLowerCase(), includePrivate, repos]) };
}
function canReadPrivate(handle) {
  return hasGithubApiToken() && currentUser()?.github?.handle?.toLowerCase() === handle.toLowerCase();
}
function readCache(includePrivate) {
  try { return JSON.parse((includePrivate ? sessionStorage : localStorage).getItem(CACHE_KEY) || '{}'); }
  catch { return {}; }
}
export function cachedTasks(handle, includePrivate = false) {
  if (!handle || (includePrivate && !canReadPrivate(handle))) return null;
  return readCache(includePrivate)[scope(handle, includePrivate).key] || null;
}

// Membership, Issue authorship and assignment alone do not qualify. A commit
// qualifies for every open Issue in that repo; a linked PR qualifies only for
// that Issue. Public/profile views never fetch private repository content.
export async function fetchTasks(handle, includePrivate = false) {
  if (!handle || (includePrivate && !canReadPrivate(handle))) return null;
  const snapshot = scope(handle, includePrivate);
  const cached = cachedTasks(handle, includePrivate);
  if (cached && Date.now() - cached.at < TTL_MS) return cached;
  if (isRateLimited()) return cached;
  if (pending.has(snapshot.key)) return pending.get(snapshot.key);
  const valid = () => scope(handle, includePrivate).key === snapshot.key &&
    (!includePrivate || canReadPrivate(handle));
  const request = async url => {
    if (!valid()) throw new Error('ACCOUNT_OR_SELECTION_CHANGED');
    const value = await fetchJson(url, 15000);
    if (!valid()) throw new Error('ACCOUNT_OR_SELECTION_CHANGED');
    return value;
  };
  const work = (async () => {
    try {
      const items = [];
      for (const repo of snapshot.repos) {
        const base = 'https://api.github.com/repos/' + repo;
        let metadata;
        try { metadata = await request(base); }
        catch (error) {
          if (error.message === 'HTTP_404') continue;
          throw error;
        }
        if (!metadata || (metadata.private && !includePrivate)) continue;
        const issues = (await pages(base + '/issues?state=open&sort=created&direction=desc', request))
          .filter(issue => !issue.pull_request && !hiddenByIssueTemplate(issue));
        if (!issues.length) continue;
        const contributor = await hasCommit(base, handle, metadata.default_branch, request);
        for (const issue of issues) {
          if (contributor || await hasLinkedPullRequest(base, issue.number, handle, request)) {
            items.push(shape({ ...issue, repository_url: base }));
          }
        }
      }
      if (!valid()) return null;
      const unique = [...new Map(items.map(item => [item.id, item])).values()];
      unique.sort((a, b) => (a.dueTs ?? Infinity) - (b.dueTs ?? Infinity) || b.createdAt - a.createdAt);
      const entry = { at: Date.now(), totalCount: unique.length, items: unique };
      const all = readCache(includePrivate);
      all[snapshot.key] = entry;
      try { (includePrivate ? sessionStorage : localStorage).setItem(CACHE_KEY, JSON.stringify(all)); } catch {}
      return entry;
    } catch { return valid() ? cached : null; }
  })();
  pending.set(snapshot.key, work);
  try { return await work; } finally { pending.delete(snapshot.key); }
}

async function pages(url, request) {
  const result = [];
  for (let page = 1; page <= 100; page++) {
    const rows = await request(url + (url.includes('?') ? '&' : '?') + 'per_page=100&page=' + page);
    if (!Array.isArray(rows)) throw new Error('INVALID_GITHUB_RESPONSE');
    result.push(...rows);
    if (rows.length < 100) return result;
  }
  throw new Error('GITHUB_PAGINATION_LIMIT');
}
async function hasCommit(base, handle, defaultBranch, request) {
  const check = async branch => {
    const rows = await request(base + '/commits?author=' + encodeURIComponent(handle) +
      '&per_page=1' + (branch ? '&sha=' + encodeURIComponent(branch) : ''));
    if (!Array.isArray(rows)) throw new Error('INVALID_GITHUB_RESPONSE');
    return rows.length > 0;
  };
  if (await check(defaultBranch)) return true;
  for (const branch of await pages(base + '/branches', request)) {
    if (branch.name !== defaultBranch && await check(branch.name)) return true;
  }
  return false;
}
async function hasLinkedPullRequest(base, number, handle, request) {
  const events = await pages(base + '/issues/' + number + '/timeline', request);
  return events.some(event => event.event === 'cross-referenced' &&
    event.source?.issue?.pull_request &&
    event.source.issue.user?.login?.toLowerCase() === handle.toLowerCase());
}
