// Read-only listing uses GitHub's own owner/organization_member affiliation
// filter. It never grants Spotcode membership or changes a post audience.
export async function githubRepositories(token, expectedHandle, fetcher = fetch) {
  const get = async path => {
    const response = await fetcher('https://api.github.com' + path, {
      headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 401) throw new Error('GitHub認証が無効です。GitHubを再認証してください。');
    if (response.status === 403) throw new Error('GitHubがアクセスを拒否しました。OrganizationのOAuth許可・SSO、またはAPIの利用制限を確認してください。');
    if (!response.ok) throw new Error('GitHubのリポジトリ取得に失敗しました（' + response.status + '）。');
    return response.json();
  };
  const user = await get('/user');
  if (!expectedHandle || user.login?.toLowerCase() !== expectedHandle.toLowerCase()) {
    throw new Error('プロフィールに連携したGitHubアカウントで再認証してください。');
  }
  const repositories = new Map();
  for (let page = 1; page <= 100; page++) {
    const rows = await get('/user/repos?affiliation=owner,organization_member&sort=pushed&per_page=100&page=' + page);
    if (!Array.isArray(rows)) throw new Error('GitHubの応答が正しくありません。');
    for (const repo of rows) {
      if (repo.owner?.id === user.id || repo.owner?.type === 'Organization') repositories.set(repo.id, repo);
    }
    if (rows.length < 100) return [...repositories.values()];
  }
  throw new Error('リポジトリの取得件数が上限を超えました。');
}
