// Labels stay scoped to the selected repository and are never cached publicly.
export async function githubLabels(repo, token, fetcher = fetch) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('INVALID_REPOSITORY');
  const labels = [];
  for (let page = 1; page <= 100; page++) {
    const response = await fetcher(`https://api.github.com/repos/${repo}/labels?per_page=100&page=${page}`, {
      headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('LABELS_UNAVAILABLE');
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.some(row => typeof row?.name !== 'string')) throw new Error('INVALID_RESPONSE');
    labels.push(...rows);
    if (rows.length < 100) return labels;
  }
  throw new Error('PAGINATION_LIMIT');
}

export function issueCreationUrl(repo, { title, assignee = '', visible = true, labels = [] }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('INVALID_REPOSITORY');
  const query = new URLSearchParams({ title: title.trim(),
    body: '**spotcode表示**: ' + (visible ? 'する' : 'しない') + '\n\n- [ ] ' + title.trim() });
  if (assignee?.trim()) query.set('assignees', assignee.trim());
  if (labels.length) query.set('labels', [...new Set(labels)].join(','));
  return 'https://github.com/' + repo + '/issues/new?' + query;
}
