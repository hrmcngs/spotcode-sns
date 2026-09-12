import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync('src/js/github-tasks.js', 'utf8')
  .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const storage = () => {
  const data = new Map();
  return { getItem: k => data.get(k), setItem: (k, v) => data.set(k, v) };
};
const issue = (id, extra = {}) => ({ id, number: id, title: 'Team issue', user: { login: 'hrmcngs' }, ...extra });
const reference = (login, pr = true) => ({ event: 'cross-referenced', actor: { login: 'someone-else' },
  source: { issue: { user: { login }, ...(pr ? { pull_request: { url: 'https://api.github.com/repos/team/project/pulls/1' } } : {}) } } });

function fixture({ contributor = false, branchContributor = false, privateRepo = false, issues = [issue(1), issue(2)], events = {}, fail = false } = {}) {
  let user = { id: 'member-a', github: { handle: 'alice' } }, selected = ['team/project'], token = true;
  const calls = [], local = storage(), session = storage();
  let pause;
  const ctx = vm.createContext({ localStorage: local, sessionStorage: session,
    currentUser: () => user, selectedTaskRepos: () => selected,
    hasGithubApiToken: () => token, isRateLimited: () => false,
    fetchJson: async raw => {
      calls.push(raw);
      if (pause) { const callback = pause; pause = null; await callback(); }
      const url = new URL(raw), path = url.pathname;
      if (path.endsWith('/project')) return { private: privateRepo, default_branch: 'main' };
      if (path.endsWith('/issues')) return Number(url.searchParams.get('page')) === 1 ? issues : [];
      if (path.endsWith('/commits')) {
        if (fail) throw new Error('HTTP_403');
        assert.equal(url.searchParams.get('author'), 'alice');
        return contributor || (branchContributor && url.searchParams.get('sha') === 'feature/test') ? [{ sha: 'commit' }] : [];
      }
      if (path.endsWith('/branches')) return [{ name: 'main' }, { name: 'feature/test' }];
      const match = path.match(/\/issues\/(\d+)\/timeline$/);
      if (match) {
        const rows = events[match[1]] || [];
        const page = Number(url.searchParams.get('page'));
        return rows.slice((page - 1) * 100, page * 100);
      }
      throw new Error('Unexpected URL: ' + raw);
    },
  });
  vm.runInContext(source, ctx);
  return { ctx, calls, local, session, setUser: value => { user = value; },
    setSelected: value => { selected = value; }, setToken: value => { token = value; },
    pause: callback => { pause = callback; } };
}
const ids = result => Array.from(result.items, row => row.id);

let f = fixture({ contributor: true, issues: [issue(1), issue(2), issue(3, { pull_request: {} }), issue(4, { labels: [{ name: 'spotcode-hidden' }] })] });
assert.deepEqual(ids(await f.ctx.fetchTasks('alice')), [1, 2]);
assert(!f.calls.some(url => url.includes('/timeline')));
const count = f.calls.length;
await f.ctx.fetchTasks('alice');
assert.equal(f.calls.length, count, 'cache avoids repeated contribution checks');

f = fixture({ branchContributor: true });
assert.deepEqual(ids(await f.ctx.fetchTasks('alice')), [1, 2]);
assert(f.calls.some(url => url.includes('sha=feature%2Ftest')));

f = fixture({ events: { 1: [reference('ALICE')], 2: [reference('bob'), reference('alice', false)] } });
assert.deepEqual(ids(await f.ctx.fetchTasks('alice')), [1], 'PR qualifies only its own linked issue, based on PR author');
f = fixture({ events: { 1: [...Array.from({ length: 100 }, () => reference('bob')), reference('alice')] } });
assert.deepEqual(ids(await f.ctx.fetchTasks('alice')), [1], 'older timeline pages are checked');
f = fixture({ issues: [issue(1, { user: { login: 'alice' } })] });
assert.deepEqual(ids(await f.ctx.fetchTasks('alice')), [], 'membership or issue authorship alone does not qualify');

f = fixture({ contributor: true, privateRepo: true });
assert.deepEqual(ids(await f.ctx.fetchTasks('alice')), []);
assert(!f.calls.some(url => url.includes('/issues')), 'public mode does not load private issue content');
assert.deepEqual(ids(await f.ctx.fetchTasks('alice', true)), [1, 2]);
assert(f.session.getItem('spotcode:gh-tasks:v3'));
assert(!f.local.getItem('spotcode:gh-tasks:v3').includes('Team issue'));
f.setUser({ id: 'member-b', github: { handle: 'bob' } });
assert.equal(f.ctx.cachedTasks('alice', true), null);
assert.equal(await f.ctx.fetchTasks('alice', true), null);
f.setUser({ id: 'member-a', github: { handle: 'alice' } });
f.setToken(false);
assert.equal(f.ctx.cachedTasks('alice', true), null);

f = fixture({ contributor: true });
await f.ctx.fetchTasks('alice');
f.setSelected([]);
assert.deepEqual(ids(await f.ctx.fetchTasks('alice')), []);
assert(!f.ctx.cachedTasks('alice').items.length);
f = fixture({ fail: true });
assert.equal(await f.ctx.fetchTasks('alice'), null, 'API failure must not become a cached empty success');
assert.equal(f.ctx.cachedTasks('alice'), null);
f = fixture({ contributor: true });
f.pause(async () => { f.setUser({ id: 'member-b', github: { handle: 'bob' } }); });
assert.equal(await f.ctx.fetchTasks('alice'), null, 'late responses cannot cross account boundaries');
assert.equal(f.ctx.cachedTasks('alice'), null);
console.log('PASS commits, non-default branches, linked PR authors, timeline pagination, hidden issues, private access, caching, selection and account switching');
