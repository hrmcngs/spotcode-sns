import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createTestI18n } from './helpers/i18n.mjs';
let list, next, requestCount = 0, cached = null;
const makeList = () => ({
  isConnected: true, innerHTML: '', retry: null,
  querySelector() { return { addEventListener(_, action) { list.retry = action; } }; },
});
const ctx = vm.createContext({ ...createTestI18n(), console,
  document: { getElementById: () => list },
  currentUser: () => ({ id: 'me' }), displayUser: x => x,
  timelineTabs: tab => tab, renderIdeaForm: () => 'Add',
  renderTimelineSkeleton: () => 'Loading', cachedPosts: () => cached,
  renderPost: p => p.hidden ? '' : `<article>${p.id}</article>`,
  followingPosts: () => { requestCount++; return next(); },
  withTimeout: p => p, url: x => x,
  hydratePostLikes: async () => {}, hydrateRepostsMine: async () => {},
  hydrateBookmarksMine: async () => {}, hydrateQuotedPosts: async () => {},
  hydratePolls: async () => {},
});
vm.runInContext(fs.readFileSync('src/js/views/home.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), ctx);
const run = code => vm.runInContext(code, ctx);
const navigate = tab => {
  if (list) list.isConnected = false;
  list = makeList(); run(`renderHome('${tab}')`); return list;
};
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
for (let i = 0; i < 3; i++) {
  navigate('foryou'); navigate('following');
  next = async () => [{ id: 'fresh-' + i }];
  await run("hydrateHome('following')"); await flush();
  assert.match(list.innerHTML, new RegExp('fresh-' + i));
}
let resolveOld;
next = () => new Promise(resolve => { resolveOld = resolve; });
navigate('following'); const old = list; const pending = run("hydrateHome('following')");
navigate('foryou'); navigate('following');
next = async () => [{ id: 'new' }];
await run("hydrateHome('following')"); await flush();
resolveOld([{ id: 'stale' }]); await pending; await flush();
assert.match(list.innerHTML, /new/); assert(!list.innerHTML.includes('stale'));
assert.equal(old.innerHTML, '');
next = async () => { throw new Error('offline'); };
navigate('following'); await run("hydrateHome('following')");
assert.match(list.innerHTML, /data-timeline-retry/); assert(!list.innerHTML.includes('location.reload'));
next = async () => [{ id: 'recovered' }]; list.retry(); await flush();
assert.match(list.innerHTML, /recovered/);
next = async () => [{ id: 'hidden', hidden: true }];
navigate('following'); await run("hydrateHome('following')"); await flush();
assert.match(list.innerHTML, /stub/);
cached = [{ id: 'hidden-cache', hidden: true }];
assert.match(run("renderHome('following')"), /Loading/);
next = async () => [{ id: 'visible' }];
await run("hydrateHome('following')"); await flush();
assert.match(list.innerHTML, /visible/);
assert(requestCount >= 8);
console.log('PASS repeated Following navigation, stale results, in-place retry, filtered-empty state, fresh fetch despite cache');
