// Repository candidates must not depend on the user's latest 30 open Issues.
export async function publicRepositories(handle, fetcher = fetch) {
  const repositories = [];
  for (let page = 1; page <= 100; page++) {
    const response = await fetcher('https://api.github.com/users/' + encodeURIComponent(handle) +
      '/repos?type=owner&sort=full_name&per_page=100&page=' + page,
      { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('リポジトリ一覧を取得できませんでした。再読み込みしてください。');
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('GitHubの応答が正しくありません');
    repositories.push(...rows.filter(row => !row.private));
    if (rows.length < 100) return repositories;
  }
  throw new Error('リポジトリの取得件数が上限を超えました。');
}

export async function publicTaskRepositories(handle, fetcher = fetch) {
  const repositories = await publicRepositories(handle, fetcher);
  return [...new Set(repositories.map(row => row.full_name).filter(Boolean))].sort();
}
