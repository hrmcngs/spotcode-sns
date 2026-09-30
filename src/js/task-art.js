// Count current Issue state, never increment a device-local completion counter.
export function isAssigned(issue, handle) {
  return !issue.pull_request && (issue.assignees || []).some(user =>
    user.login?.toLowerCase() === handle.toLowerCase());
}

export function completedByAssignee(issue, handle) {
  return isAssigned(issue, handle) && issue.state === 'closed' &&
    issue.state_reason === 'completed' &&
    issue.closed_by?.login?.toLowerCase() === handle.toLowerCase();
}

export async function loadTaskArt(repos, request) {
  const issues = new Map();
  for (const repo of [...new Set(repos)]) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) continue;
    const base = 'https://api.github.com/repos/' + repo;
    const metadata = await request(base);
    // This public artwork intentionally contains public Issues only.
    if (metadata.private !== false) throw new Error('PUBLIC_REPOSITORY_REQUIRED');
    for (let page = 1; ; page++) {
      if (page > 100) throw new Error('PAGINATION_LIMIT');
      const rows = await request(base + '/issues?state=all&per_page=100&page=' + page);
      if (!Array.isArray(rows)) throw new Error('INVALID_RESPONSE');
      for (let issue of rows) {
        if (issue.pull_request || !issue.assignees?.length) continue;
        if ((issue.labels || []).some(label => ['spotcode-hidden', 'spotcode非表示'].includes(String(label.name || '').toLowerCase())) ||
            /(?:\*\*)?\s*spotcode\s*表示\s*[:：]?\s*(?:\*\*)?\s*[:：]?\s*(?:しない|非表示|off|false|no)(?:\s|$)/im.test(issue.body || '')) continue;
        // List responses do not reliably include closed_by. Read the Issue.
        if (issue.state === 'closed' && issue.state_reason === 'completed') {
          issue = await request(base + '/issues/' + issue.number);
        }
        if (!issue.pull_request && issue.assignees?.length && issue.state_reason !== 'not_planned') {
          issues.set(issue.id, { ...issue, repo });
        }
      }
      if (rows.length < 100) break;
    }
  }
  const items = [...issues.values()];
  return { total: items.length,
    completed: items.filter(issue => (issue.assignees || []).some(user => completedByAssignee(issue, user.login))).length,
    open: items.filter(issue => issue.state === 'open') };
}

export const ART_TYPES = ['tree', 'flower', 'cube', 'puzzle'];

// Fractional pieces also change visibly when a project has more than nine tasks.
export function renderTaskArt(type, completed, goal) {
  const count = Math.min(9, Math.max(0, completed / Math.max(1, goal) * 9));
  const amount = index => Math.min(1, Math.max(0, count - index));
  const part = (index, shape) => '<g opacity="' + (.12 + .88 * amount(index)) + '">' + shape + '</g>';
  let shapes = '';
  if (type === 'tree') {
    shapes = part(0, '<path d="M104 181V79h16v102z" fill="#966542"/>');
    [[82,114],[142,114],[65,88],[159,88],[85,61],[139,61],[112,40],[112,88]].forEach(([x,y], i) => {
      shapes += part(i + 1, `<circle cx="${x}" cy="${y}" r="28" fill="${i % 2 ? '#36a876' : '#21845e'}"/>`);
    });
  } else if (type === 'flower') {
    shapes = part(0, '<path d="M109 185V94h6v91z" fill="#21845e"/>') +
      part(1, '<path d="M111 155Q64 154 72 125Q111 124 111 155M113 166Q159 164 154 136Q119 135 113 166" fill="#36a876"/>');
    for (let i = 0; i < 6; i++) shapes += part(i + 2, `<ellipse cx="112" cy="56" rx="18" ry="31" transform="rotate(${i * 60} 112 88)" fill="#e978a3"/>`);
    shapes += part(8, '<circle cx="112" cy="88" r="22" fill="#f4c654"/>');
  } else {
    const colors = ['#e45d57','#efaa45','#f2d558','#49ad80','#5e9fdf','#a18ad7','#e978a3','#48b9b2','#ef8655'];
    for (let i = 0; i < 9; i++) {
      const x = 32 + i % 3 * 54, y = 22 + Math.floor(i / 3) * 54;
      if (type === 'cube') {
        shapes += `<rect x="${x}" y="${y}" width="50" height="50" rx="6" fill="${colors[i === 4 ? 0 : i]}" stroke="#253143" stroke-width="3"/><rect x="${x}" y="${y}" width="50" height="50" rx="6" fill="#49ad80" opacity="${amount(i)}" stroke="#253143" stroke-width="3"/>`;
      } else {
        const right = i % 3 < 2 ? 'v17c18 -10 18 30 0 20v17' : 'v54';
        const bottom = i < 6 ? 'h-17c10 18 -30 18 -20 0h-17' : 'h-54';
        const left = i % 3 > 0 ? 'v-17c18 10 18 -30 0 -20v-17' : 'v-54';
        const top = i >= 3 ? 'h17c-10 18 30 18 20 0h17' : 'h54';
        shapes += part(i, `<path d="M${x} ${y}${top}${right}${bottom}${left}z" fill="${colors[i]}" stroke="currentColor" stroke-width="1.5"/>`);
      }
    }
  }
  return '<svg viewBox="0 0 224 208" aria-hidden="true" focusable="false">' + shapes + '</svg>';
}
