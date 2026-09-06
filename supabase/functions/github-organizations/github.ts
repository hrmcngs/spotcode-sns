export type Organization = { id: number; login: string; role: string };

export async function githubJSON(path: string, token: string, fetcher = fetch) {
  const response = await fetcher('https://api.github.com' + path, {
    headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('GitHubへのアクセスを確認できません。Organizationの許可を確認して再連携してください。');
  return response.json();
}

export async function githubPages(path: string, token: string, fetcher = fetch) {
  const rows: any[] = [];
  // Never publish a partial membership snapshot; a failed page aborts the sync.
  for (let page = 1; page <= 100; page++) {
    const batch = await githubJSON(path + (path.includes('?') ? '&' : '?') + 'per_page=100&page=' + page, token, fetcher);
    if (!Array.isArray(batch)) throw new Error('GitHubの応答が正しくありません');
    rows.push(...batch);
    if (batch.length < 100) return rows;
  }
  throw new Error('GitHubの取得件数が上限を超えました');
}

export async function verifiedOrganizations(token: string, identityIDs: string[], fetcher = fetch) {
  const user = await githubJSON('/user', token, fetcher);
  if (!identityIDs.includes(String(user.id))) throw new Error('連携済みのGitHubアカウントで認証してください');
  const [allowed, memberships] = await Promise.all([
    githubPages('/user/orgs', token, fetcher),
    githubPages('/user/memberships/orgs?state=active', token, fetcher),
  ]);
  const allowedIDs = new Set(allowed.map(org => org.id));
  const organizations: Organization[] = memberships
    .filter(m => m.state === 'active' && allowedIDs.has(m.organization.id))
    .map(m => ({ id: m.organization.id, login: m.organization.login, role: m.role }));
  return { user, organizations };
}

export async function authorizedRepositories(token: string, userID: number, orgs: Organization[], fetcher = fetch) {
  const owners = new Set([userID, ...orgs.map(org => org.id)]);
  const repos = await githubPages('/user/repos?affiliation=owner,organization_member&sort=pushed', token, fetcher);
  return repos.filter(repo => owners.has(repo.owner?.id));
}
