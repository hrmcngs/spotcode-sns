import { t } from './i18n.js';
import { fetchWalkingRoute } from './walking-route.js';

export function attachWalkingRoutes(L, map, root) {
  if (!root) return () => {};
  const message = root.querySelector('[data-walk-status]');
  const startButton = root.querySelector('[data-walk-start]');
  const endButton = root.querySelector('[data-walk-end]');
  const retry = root.querySelector('[data-walk-retry]');
  const layer = L.layerGroup().addTo(map);
  let choosing = null, start = null, end = null, controller = null, version = 0;
  const markers = {};
  const cancel = () => { version++; controller?.abort(); controller = null; retry.disabled = true; };
  const choose = (value) => {
    cancel(); choosing = value;
    startButton.setAttribute('aria-pressed', String(value === 'start'));
    endButton.setAttribute('aria-pressed', String(value === 'end'));
    map.getContainer().style.cursor = 'crosshair';
    message.textContent = value === 'start' ? t("地図上で出発地を選んでください。") : t("地図上で目的地を選んでください。");
  };
  const search = async () => {
    if (!start || !end) return;
    cancel(); layer.clearLayers();
    const mine = version;
    const request = new AbortController();
    controller = request;
    const timeout = setTimeout(() => request.abort(), 35000);
    message.textContent = t("道路データから徒歩の最短ルートを探索中…");
    try {
      const result = await fetchWalkingRoute(start, end, request.signal);
      if (mine !== version || !root.isConnected) return;
      L.polyline(result.points, { color: '#1d9bf0', weight: 6 }).addTo(layer);
      map.fitBounds(L.latLngBounds(result.points), { padding: [30, 30] });
      message.textContent = t("道路上の距離 {km} km（取得範囲内の最短）。選択地点から道路まで：出発 {start}m・到着 {end}m。この接続区間は案内対象外です。", { km: (result.meters / 1000).toFixed(2), start: Math.round(result.startGap), end: Math.round(result.endGap) });
    } catch (error) {
      if (mine !== version || !root.isConnected) return;
      message.textContent = error.name === 'AbortError' ? t("道路データの取得がタイムアウトしました。再試行してください。") : t(error.message) === error.message && !/[ぁ-んァ-ヶ一-龠]/.test(error.message) ? t("ルート探索に失敗しました。再試行してください。") : t(error.message);
    } finally {
      clearTimeout(timeout);
      if (mine === version) { retry.disabled = false; controller = null; }
    }
  };
  const onClick = (event) => {
    if (!choosing) return;
    const key = choosing;
    const point = { lat: event.latlng.lat, lng: event.latlng.lng };
    if (key === 'start') start = point; else end = point;
    if (markers[key]) map.removeLayer(markers[key]);
    markers[key] = L.circleMarker([point.lat, point.lng], {
      radius: 9, color: key === 'start' ? '#15803d' : '#dc2626', fillOpacity: 1,
    }).addTo(map).bindTooltip(key === 'start' ? t("出発地") : t("目的地"), { permanent: true });
    choosing = null; map.getContainer().style.cursor = '';
    startButton.setAttribute('aria-pressed', 'false'); endButton.setAttribute('aria-pressed', 'false');
    layer.clearLayers();
    if (start && end) void search();
    else choose(start ? 'end' : 'start');
  };
  startButton.onclick = () => choose('start');
  endButton.onclick = () => choose('end');
  retry.onclick = () => { void search(); };
  root.querySelector('[data-walk-clear]').onclick = () => {
    cancel(); choosing = null; start = null; end = null;
    layer.clearLayers();
    Object.values(markers).forEach(marker => map.removeLayer(marker));
    startButton.setAttribute('aria-pressed', 'false'); endButton.setAttribute('aria-pressed', 'false');
    map.getContainer().style.cursor = '';
    message.textContent = t("出発地と目的地を地図で選択してください。");
  };
  map.on('click', onClick);
  const dispose = () => { cancel(); map.off('click', onClick); map.off('unload', dispose); };
  map.on('unload', dispose);
  return dispose;
}
