// User-facing display toggles that affect rendering globally via
// data-attributes on <html>. Stored in localStorage so the choice
// survives reloads / new tabs.
//
// Currently exposes a single toggle: whether decorative badges
// (the {} Programmer pill, the 「組織」 chip on profile names, the
// 「アイデア」 / WIP post-kind chip, the visibility hint, etc.)
// render or get CSS-hidden. The defaults are visible-everything;
// flipping the toggle off in /settings → 表示 applies
// `data-hide-badges="1"` on <html> and the matching CSS rules
// suppress every badge selector at once.

const KEY = 'spotcode:hide-badges';
// Per-device toggle for the profile "Open issues (task)" card. When
// hidden, the card doesn't render at all — no fetch, no rate-limit
// budget spent. Same shape as `hide-badges`: default is visible.
const KEY_TASKS_HIDDEN = 'spotcode:hide-tasks';
const KEY_TASK_REPOS = 'spotcode:hidden-task-repos';
const KEY_PRIVATE_TASKS = 'spotcode:private-tasks';
let syncedUserId = '';

export async function hydrateIssueDisplayPrefs(userId) {
  if (!userId) return;
  const { getClient } = await import('./supa.js');
  const supa = await getClient();
  const { data, error } = await supa.from('issue_display_preferences')
    .select('hidden_repos,include_private').eq('user_id', userId).maybeSingle();
  if (error) return; // Stage 33 not installed yet: retain device-local values.
  syncedUserId = userId;
  if (data) {
    try {
      localStorage.setItem(KEY_TASK_REPOS, JSON.stringify(data.hidden_repos || []));
      data.include_private ? localStorage.setItem(KEY_PRIVATE_TASKS, '1') : localStorage.removeItem(KEY_PRIVATE_TASKS);
    } catch {}
  } else {
    await persistIssueDisplayPrefs();
  }
}

async function persistIssueDisplayPrefs() {
  if (!syncedUserId) return;
  try {
    const { getClient } = await import('./supa.js');
    const supa = await getClient();
    await supa.from('issue_display_preferences').upsert({
      user_id: syncedUserId,
      hidden_repos: hiddenTaskRepos(),
      include_private: privateTasksEnabled(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
  } catch {}
}

export function badgesHidden() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function setBadgesHidden(hide) {
  try {
    if (hide) localStorage.setItem(KEY, '1');
    else      localStorage.removeItem(KEY);
  } catch {}
  applyDisplayPrefs();
}

export function tasksHidden() {
  try { return localStorage.getItem(KEY_TASKS_HIDDEN) === '1'; } catch { return false; }
}

export function setTasksHidden(hide) {
  try {
    if (hide) localStorage.setItem(KEY_TASKS_HIDDEN, '1');
    else      localStorage.removeItem(KEY_TASKS_HIDDEN);
  } catch {}
  applyDisplayPrefs();
}

export function hiddenTaskRepos() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY_TASK_REPOS) || '[]');
    return Array.isArray(value) ? value.map(String) : [];
  } catch { return []; }
}

export function setTaskRepoVisible(repo, visible) {
  const hidden = new Set(hiddenTaskRepos());
  if (visible) hidden.delete(repo); else hidden.add(repo);
  try { localStorage.setItem(KEY_TASK_REPOS, JSON.stringify([...hidden])); } catch {}
  persistIssueDisplayPrefs();
}

export function privateTasksEnabled() {
  try { return localStorage.getItem(KEY_PRIVATE_TASKS) === '1'; } catch { return false; }
}

export function setPrivateTasksEnabled(enabled) {
  try { enabled ? localStorage.setItem(KEY_PRIVATE_TASKS, '1') : localStorage.removeItem(KEY_PRIVATE_TASKS); } catch {}
  persistIssueDisplayPrefs();
}

// Apply every display-pref attribute on <html>. Call once on boot
// and after any setter so a fresh page load matches the click flow.
export function applyDisplayPrefs() {
  const root = document.documentElement;
  if (badgesHidden()) root.dataset.hideBadges = '1';
  else                delete root.dataset.hideBadges;
  if (tasksHidden())  root.dataset.hideTasks = '1';
  else                delete root.dataset.hideTasks;
}
