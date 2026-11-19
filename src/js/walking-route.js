// Local distance-first routing over a bounded OpenStreetMap walking graph.
export function distance(a, b) {
  const rad = Math.PI / 180;
  const dlat = (b.lat - a.lat) * rad, dlng = (b.lng - a.lng) * rad;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dlng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

const excluded = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'construction', 'proposed', 'raceway']);
function walkable(tags = {}) {
  if (!tags.highway || tags.area === 'yes' || tags.indoor === 'yes') return false;
  const access = tags.foot || tags.access;
  if (['no', 'private', 'use_sidepath', 'destination', 'customers'].includes(access)) return false;
  if (excluded.has(tags.highway) && !['yes', 'designated', 'permissive'].includes(tags.foot)) return false;
  // Conditional permissions need a time-aware routing engine.
  return !tags['foot:conditional'] && !tags['access:conditional'];
}

export function buildGraph(elements) {
  const nodes = new Map(elements.filter(e => e.type === 'node').map(e => [e.id, e]));
  const graph = new Map(), segments = [];
  const add = (a, b, length) => {
    if (!graph.has(a)) graph.set(a, []);
    if (!graph.has(b)) graph.set(b, []);
    graph.get(a).push({ id: b, length });
  };
  for (const way of elements) {
    if (way.type !== 'way' || !walkable(way.tags)) continue;
    const direction = way.tags['oneway:foot'];
    for (let i = 1; i < way.nodes.length; i++) {
      const a = nodes.get(way.nodes[i - 1]), b = nodes.get(way.nodes[i]);
      if (!a || !b) continue;
      if ([a, b].some(n => ['no', 'private'].includes(n.tags?.foot || n.tags?.access) ||
        (n.tags?.barrier && !['yes', 'designated', 'permissive'].includes(n.tags?.foot)))) continue;
      const length = distance(a, b);
      const forward = direction !== '-1', backward = !['yes', '1', 'true'].includes(direction);
      if (forward) add(a.id, b.id, length);
      if (backward) add(b.id, a.id, length);
      segments.push({ a, b, length, forward, backward });
    }
  }
  return { nodes, graph, segments };
}

function snap(point, segments) {
  let best = null;
  const scale = Math.cos(point.lat * Math.PI / 180);
  for (const segment of segments) {
    const { a, b } = segment;
    const x = (b.lng - a.lng) * scale, y = b.lat - a.lat;
    const fraction = Math.max(0, Math.min(1, (((point.lng - a.lng) * scale * x) + (point.lat - a.lat) * y) / (x * x + y * y || 1)));
    const pos = { lat: a.lat + fraction * (b.lat - a.lat), lng: a.lng + fraction * (b.lng - a.lng) };
    const gap = distance(point, pos);
    if (!best || gap < best.gap) best = { ...segment, fraction, pos, gap };
  }
  if (!best || best.gap > 150) throw new Error('近くに歩行可能な道路がありません。道路の上を選び直してください。');
  return best;
}

// A binary min-heap keeps Dijkstra practical on city-sized graphs.
function push(heap, item) {
  heap.push(item);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heap[parent].cost <= item.cost) break;
    heap[i] = heap[parent]; i = parent;
  }
  heap[i] = item;
}
function pop(heap) {
  const first = heap[0], last = heap.pop();
  if (heap.length) {
    let i = 0;
    while (i * 2 + 1 < heap.length) {
      let child = i * 2 + 1;
      if (child + 1 < heap.length && heap[child + 1].cost < heap[child].cost) child++;
      if (heap[child].cost >= last.cost) break;
      heap[i] = heap[child]; i = child;
    }
    heap[i] = last;
  }
  return first;
}

export function shortestWalk(elements, start, end) {
  const { nodes, graph, segments } = buildGraph(elements);
  const from = snap(start, segments), to = snap(end, segments);
  const source = 'start', target = 'end';
  nodes.set(source, from.pos); nodes.set(target, to.pos);
  graph.set(source, []); graph.set(target, []);
  const link = (a, b, length) => graph.get(a).push({ id: b, length });
  if (from.fraction === 0) link(source, from.a.id, 0);
  if (from.fraction === 1) link(source, from.b.id, 0);
  if (to.fraction === 0) link(to.a.id, target, 0);
  if (to.fraction === 1) link(to.b.id, target, 0);
  if (from.forward) link(source, from.b.id, (1 - from.fraction) * from.length);
  if (from.backward) link(source, from.a.id, from.fraction * from.length);
  if (to.forward) link(to.a.id, target, to.fraction * to.length);
  if (to.backward) link(to.b.id, target, (1 - to.fraction) * to.length);
  if (from.a.id === to.a.id && from.b.id === to.b.id &&
      ((from.fraction <= to.fraction && from.forward) || (from.fraction >= to.fraction && from.backward))) {
    link(source, target, Math.abs(to.fraction - from.fraction) * from.length);
  }
  const costs = new Map([[source, 0]]), previous = new Map(), heap = [];
  push(heap, { id: source, cost: 0 });
  while (heap.length) {
    const current = pop(heap);
    if (current.cost !== costs.get(current.id)) continue;
    if (current.id === target) break;
    for (const next of graph.get(current.id) || []) {
      const cost = current.cost + next.length;
      if (cost >= (costs.get(next.id) ?? Infinity)) continue;
      costs.set(next.id, cost); previous.set(next.id, current.id);
      push(heap, { id: next.id, cost });
    }
  }
  if (!costs.has(target)) throw new Error('取得範囲内で徒歩ルートが見つかりません。地点を選び直してください。');
  const points = [];
  for (let id = target; id !== undefined; id = previous.get(id)) {
    const point = nodes.get(id); points.push([point.lat, point.lng]);
  }
  return { points: points.reverse(), meters: costs.get(target), startGap: from.gap, endGap: to.gap };
}

export async function fetchWalkingRoute(start, end, signal) {
  if ([start, end].some(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lng) || Math.abs(p.lat) > 80 || Math.abs(p.lng) > 179)) throw new Error('この地域のルート探索には対応していません。');
  if (distance(start, end) > 5000) throw new Error('現在は直線距離5km以内に対応しています。');
  const margin = 0.012;
  const south = Math.max(-85, Math.min(start.lat, end.lat) - margin);
  const north = Math.min(85, Math.max(start.lat, end.lat) + margin);
  const lngMargin = margin / Math.max(0.1, Math.cos(start.lat * Math.PI / 180));
  const west = Math.min(start.lng, end.lng) - lngMargin, east = Math.max(start.lng, end.lng) + lngMargin;
  const query = `[out:json][timeout:25];way[highway](${south},${west},${north},${east});(._;>;);out body;`;
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST', body: new URLSearchParams({ data: query }), signal,
  });
  if (!response.ok) throw new Error('道路データを取得できませんでした。時間をおいて再試行してください。');
  const data = await response.json();
  if (data.remark || !Array.isArray(data.elements)) throw new Error('道路データの取得が完了しませんでした。再試行してください。');
  return shortestWalk(data.elements, start, end);
}
