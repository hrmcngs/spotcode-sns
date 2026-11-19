import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const source = await fs.readFile(new URL('../src/js/walking-route.js', import.meta.url), 'utf8');
const { shortestWalk, buildGraph, distance, fetchWalkingRoute } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const node = (id, lat, lng, tags) => ({ type: 'node', id, lat, lng, tags });
const way = (id, nodes, tags = {}) => ({ type: 'way', id, nodes, tags: { highway: 'residential', ...tags } });
const a = node(1, 35, 139), b = node(2, 35, 139.002), c = node(3, 35.002, 139.001);
const roads = [a, b, c, way(10, [1, 2]), way(11, [1, 3, 2])];
const route = shortestWalk(roads, a, b);
assert.ok(Math.abs(route.meters - distance(a, b)) < 0.01, 'Choose shortest distance, not detour');
const partial = shortestWalk(roads, { lat: 35, lng: 139.0005 }, { lat: 35, lng: 139.0015 });
assert.ok(Math.abs(partial.meters - distance(a, b) / 2) < 0.1, 'Snap to road segment, not nearest node');
const oneWay = [a, b, way(10, [1, 2], { 'oneway:foot': 'yes' })];
assert.ok(shortestWalk(oneWay, a, b).meters > 0);
assert.throws(() => shortestWalk(oneWay, b, a), /見つかりません/, 'Respect pedestrian direction');
const branch = [a, b, c, way(10, [1, 2], { 'oneway:foot': 'yes' }), way(11, [1, 3])];
assert.ok(shortestWalk(branch, a, c).meters > 0, 'Allow departure along another road at exact junction');
assert.ok(shortestWalk(branch, c, a).meters > 0, 'Allow arrival at exact junction');
assert.ok(shortestWalk([a, b, way(10, [1, 2], { oneway: 'yes' })], b, a).meters > 0, 'Vehicle direction does not imply pedestrian direction');
for (const tags of [{ foot: 'no' }, { access: 'private' }, { highway: 'motorway' }, { 'foot:conditional': 'no @ (night)' }]) {
  assert.equal(buildGraph([a, b, way(10, [1, 2], tags)]).segments.length, 0);
}
assert.equal(buildGraph([a, b, way(10, [1, 2], { access: 'no', foot: 'yes' })]).segments.length, 1);
assert.throws(() => shortestWalk(roads, { lat: 36, lng: 140 }, b), /近く/);
assert.throws(() => shortestWalk([a, b, c, node(4, 35.002, 139.003), way(10, [1, 2]), way(11, [3, 4])], a, c), /見つかりません/);
await assert.rejects(fetchWalkingRoute(a, { lat: 36, lng: 139 }), /5km/);
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ elements: roads }) });
  assert.ok((await fetchWalkingRoute(a, b)).meters > 0);
  globalThis.fetch = async () => ({ ok: false });
  await assert.rejects(fetchWalkingRoute(a, b), /取得できません/);
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ elements: roads, remark: 'timeout' }) });
  await assert.rejects(fetchWalkingRoute(a, b), /完了しません/);
} finally { globalThis.fetch = originalFetch; }
console.log('Walking route tests passed');
