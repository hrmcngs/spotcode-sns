import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const context = vm.createContext({ AbortSignal });
vm.runInContext(fs.readFileSync('src/js/github-repositories.js', 'utf8').replace('export ', ''), context);
const own = { id: 1, full_name: 'me/site', owner: { id: 10, type: 'User' } };
const org = { id: 2, full_name: 'org/private', private: true, fork: true, owner: { id: 20, type: 'Organization' } };
const unrelated = { id: 3, full_name: 'other/repo', owner: { id: 30, type: 'User' } };
const calls = [];
const fetcher = async (url, options) => {
  calls.push(url);
  assert.equal(options.headers.Authorization, 'Bearer test-token');
  const path = new URL(url);
  assert.equal(path.origin, 'https://api.github.com');
  if (path.pathname === '/user') return { ok: true, json: async () => ({ id: 10, login: 'Me' }) };
  assert.equal(path.searchParams.get('affiliation'), 'owner,organization_member');
  const rows = path.searchParams.get('page') === '1'
    ? [own, org, unrelated, ...Array.from({ length: 97 }, (_, i) => ({ ...own, id: i + 100 }))]
    : [org, { ...own, id: 999, full_name: 'me/hrmc.ngs.computer' }];
  return { ok: true, json: async () => rows };
};
const repos = await context.githubRepositories('test-token', 'me', fetcher);
assert.equal(calls.length, 3);
assert.equal(repos.length, 100);
assert.ok(repos.some(r => r.full_name === 'org/private' && r.fork));
assert.ok(repos.some(r => r.full_name === 'me/hrmc.ngs.computer'));
assert.ok(!repos.some(r => r.id === unrelated.id));
assert.equal(repos.filter(r => r.id === org.id).length, 1);
await assert.rejects(context.githubRepositories('test-token', 'another', fetcher), /再認証/);
for (const status of [401, 403, 500]) {
  await assert.rejects(context.githubRepositories('test-token', 'me', async () => ({ ok: false, status })), /GitHub/);
}
await assert.rejects(context.githubRepositories('test-token', 'me', async () => { throw new Error('offline'); }), /offline/);
console.log('PASS own and organization repositories, private forks, all pages, deduplication, account mismatch and GitHub failures');
