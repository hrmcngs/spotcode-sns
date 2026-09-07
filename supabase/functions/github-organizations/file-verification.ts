export const verificationPath = 'spotcode-verification.txt';
export async function publicGithub(path: string, fetcher = fetch) {
  const response = await fetcher('https://api.github.com' + path, {
    headers: { Accept: 'application/vnd.github+json', 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('GitHubの公開リポジトリ・確認ファイルを取得できません。公開設定とファイルの保存を確認してください。');
  return response.json();
}
export async function organizationForVerification(login: string, fetcher = fetch) {
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(login)) throw new Error('Organization名を入力してください');
  const org = await publicGithub('/orgs/' + encodeURIComponent(login), fetcher);
  if (!Number.isSafeInteger(org.id) || typeof org.login !== 'string') throw new Error('Organizationを確認できません');
  return org;
}
export async function verifyOrganizationFile(orgID: number, login: string, expected: string, fetcher = fetch) {
  const repo = await publicGithub('/repos/' + encodeURIComponent(login) + '/.github', fetcher);
  if (repo.owner?.id !== orgID || repo.owner?.type !== 'Organization' || repo.private || repo.fork) {
    throw new Error('対象Organizationが所有する公開の.githubリポジトリに確認ファイルを追加してください（Forkは使えません）。');
  }
  const file = await publicGithub('/repos/' + encodeURIComponent(login) + '/.github/contents/' + verificationPath, fetcher);
  if (file.type !== 'file' || file.encoding !== 'base64' || file.size > 1024 || typeof file.content !== 'string') throw new Error('確認ファイルの形式が正しくありません');
  let content: string;
  try { content = atob(file.content.replace(/\s/g, '')); } catch { throw new Error('確認ファイルを読み取れません'); }
  if (content.trim() !== expected) throw new Error('確認コードが一致しません。発行された内容をそのまま保存してください。');
}
