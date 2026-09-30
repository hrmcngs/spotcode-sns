import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createTestI18n } from './helpers/i18n.mjs';

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync('src/js/task-art.js', 'utf8').replace(/^export /gm, ''), ctx);
const issue = (id, extra = {}) => ({ id, number: id, title: 'Task', state: 'open',
  assignees: [{ login: 'alice' }], ...extra });
const done = (id, login = 'alice', extra = {}) => issue(id, {
  state: 'closed', state_reason: 'completed', closed_by: { login }, ...extra });

assert(ctx.completedByAssignee(done(1, 'ALICE'), 'alice'));
assert(!ctx.completedByAssignee(done(1, 'bob'), 'alice'));
assert(!ctx.completedByAssignee(done(1, 'alice', { state: 'open' }), 'alice'));
assert(!ctx.completedByAssignee(done(1, 'alice', { state_reason: 'not_planned' }), 'alice'));
assert(!ctx.completedByAssignee(done(1, 'alice', { pull_request: {} }), 'alice'));

const rows = [done(1), done(2, 'bob', { assignees: [{ login: 'bob' }, { login: 'alice' }] }),
  issue(3), done(4, 'maintainer'), issue(5, { assignees: [] }),
  done(6, 'alice', { state_reason: 'not_planned' }), issue(7, { pull_request: {} }),
  done(8, 'alice', { labels: [{ name: 'spotcode-hidden' }] }),
  issue(9, { body: '**spotcode表示**: しない' }), done(1)];
const calls = [];
const request = async raw => {
  calls.push(raw);
  const url = new URL(raw);
  if (url.pathname.endsWith('/project')) return { private: false };
  if (url.pathname.endsWith('/issues')) return rows.map(({ closed_by, ...item }) => item);
  return rows.find(row => row.number === Number(url.pathname.split('/').at(-1)));
};
let result = await ctx.loadTaskArt(['team/project', 'team/project'], request);
assert.equal(result.total, 4);
assert.equal(result.completed, 2, 'All assignees contribute; multi-assignee Issues count once');
assert.equal(result.open.length, 1);
assert(calls.some(url => url.endsWith('/issues/2')), 'Read closer from Issue detail');
rows[0] = issue(1); rows.pop();
result = await ctx.loadTaskArt(['team/project'], request);
assert.equal(result.completed, 1, 'Reopening removes completion');
assert.equal(result.total, 4);

let pages = 0;
result = await ctx.loadTaskArt(['team/project'], async url => {
  if (url.endsWith('/project')) return { private: false };
  pages++;
  return pages === 1 ? Array.from({ length: 100 }, (_, i) => issue(i)) : [issue(100)];
});
assert.equal(result.total, 101);
assert.equal(pages, 2, 'Fetch all Issue pages');
let privateCalls = 0;
await assert.rejects(() => ctx.loadTaskArt(['team/project'], async () => {
  privateCalls++; return { private: true };
}), /PUBLIC_REPOSITORY_REQUIRED/);
assert.equal(privateCalls, 1, 'Never fetch private Issue contents');
await assert.rejects(() => ctx.loadTaskArt(['team/project'], async url => {
  if (url.endsWith('/project')) return { private: false };
  if (url.includes('?')) return [done(1)];
  throw new Error('HTTP_403');
}), /HTTP_403/, 'A failed detail request must not publish partial totals');

for (const type of ['tree', 'flower', 'cube', 'puzzle']) {
  assert.notEqual(ctx.renderTaskArt(type, 0, 100), ctx.renderTaskArt(type, 1, 100), 'Each completion changes artwork');
  assert.notEqual(ctx.renderTaskArt(type, 0, 9), ctx.renderTaskArt(type, 9, 9));
  assert(!ctx.renderTaskArt(type, 0, 0).includes('NaN'));
}
for (const lang of ['ja', 'en']) {
  const ui = vm.createContext({ ...createTestI18n(lang),
    renderTaskTemplates: () => '',
    selectedTaskRepos: () => ['team/project', '\"><script>'], tasksHidden: () => false,
    ART_TYPES: ['tree', 'flower', 'cube', 'puzzle'] });
  vm.runInContext(fs.readFileSync('src/js/views/project-art.js', 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), ui);
  const html = ui.renderProjectArt();
  assert(html.includes('team/project'));
  assert(!html.includes('<script>'));
  assert(html.includes(lang === 'ja' ? 'プロジェクトの達成アート' : 'Project completion art'));
}
console.log('Project task art tests passed');
