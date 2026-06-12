// 'https://github.com/owner/repo/blob/main/path/to/file.js#L10-L20' を分解
export function parseGithubLink(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'github.com') return null;
    const [owner, repo, kind, ref, ...rest] = u.pathname.split('/').filter(Boolean);
    if (!owner || !repo) return null;
    return {
      owner, repo,
      kind: kind || null,
      ref:  ref  || null,
      path: rest.join('/') || null,
      lineRange: u.hash.replace(/^#L/, '') || null,
      rawUrl: kind === 'blob' ? 'https://raw.githubusercontent.com/' + owner + '/' + repo + '/' + ref + '/' + rest.join('/') : null,
    };
  } catch { return null; }
}
