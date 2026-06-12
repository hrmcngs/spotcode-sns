// ファイルサイズ → 色のグラデーション。
// 0KB→緑, 10KB→黄, 50KB→橙, 100KB+→赤
export function sizeToColor(bytes) {
  const kb = bytes / 1024;
  if (kb < 5)   return "#3ecfcf";
  if (kb < 20)  return "#a6e22e";
  if (kb < 50)  return "#febc2e";
  if (kb < 100) return "#ff9933";
  return "#f87171";
}
export function renderFileBadge(name, bytes) {
  const color = sizeToColor(bytes);
  const kb = (bytes / 1024).toFixed(1);
  return ;
}
