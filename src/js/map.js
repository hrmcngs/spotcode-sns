// Leaflet 等を後で差し込む想定の位置情報マップ placeholder。
// 各スポットには id, lat, lng, ideaCount を持たせる。
export function renderMapPlaceholder(spots) {
  const dots = (spots || []).map(s => '<li>📍 ' + s.id + ' (' + s.lat.toFixed(3) + ', ' + s.lng.toFixed(3) + ') — ' + (s.ideaCount || 0) + ' ideas</li>').join('');
  return '<section class="map"><h2>Map (placeholder)</h2><ul>' + dots + '</ul></section>';
}
