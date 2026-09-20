import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync('src/js/main.js', 'utf8');
const rail = { innerHTML: '' };
let posts = null, requests = 0, cacheListener;
let finishFetch;
const ctx = vm.createContext({
  rail, app: { innerHTML: '' },
  document: { querySelector: () => null },
  headerSizeObserver: {}, observedTimelineToolbar: null,
  forceUnlockBodyScroll() {}, setActiveNav() {}, restoreComposerDraft() {},
  renderHome: () => 'home', hydrateHome() {}, pendingSpot: null,
  renderSettings: () => 'settings', bindSettings() {},
  currentUser: () => null, allUsers: () => ({}),
  onPostsCacheChange: fn => { cacheListener = fn; },
  hydrateMyFollows: async () => {}, recommendedProfiles: async () => {},
  cachedPosts: () => posts,
  postsWithSpots: async () => {
    requests++;
    await new Promise(resolve => { finishFetch = resolve; });
    posts = [{ city: '京都市', prefecture: '京都府', count: 3 }];
    cacheListener();
  },
  trendingCities: () => posts || [],
  emptyCounts: {}, renderGrass: () => 'activity',
  t: key => key, icon: () => '', escape: value => value,
  url: path => path, jpToRomaji: () => null,
});
vm.runInContext(source.slice(source.indexOf('const RAIL_REFRESH_MS'), source.indexOf('function setActiveNav')), ctx);
vm.runInContext(source.slice(source.indexOf('function dispatch(path)'), source.indexOf('function syncSpotChip')), ctx);
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

ctx.dispatch('/');
assert.match(rail.innerHTML, /activity/, 'First navigation paints the rail immediately');
await flush();
assert.equal(requests, 1, 'First navigation fetches spot posts without visiting the map');
ctx.dispatch('/following');
await flush();
assert.equal(requests, 1, 'Navigation shares the in-flight refresh');
finishFetch();
await flush();
assert.match(rail.innerHTML, /京都市/);
assert.match(rail.innerHTML, /\/spots\/%E4%BA%AC%E9%83%BD%E5%B8%82/);
assert.match(rail.innerHTML, /3 common.ideas/);
ctx.dispatch('/settings');
await flush();
assert.match(rail.innerHTML, /京都市/, 'Ranking remains visible after navigation');
assert.equal(requests, 1, 'Fresh rail data is reused');
console.log('PASS first-navigation rail paint, background spot fetch, ranking links/counts and refresh throttling');
