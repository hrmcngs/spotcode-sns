// ファイルサイズ → 色のグラデーション
// 0KB→緑系, 増えるほど暖色系へ
export function sizeToColor(bytes) {
  const kb = bytes / 1024;
  if (kb < 5)   return '#3ecfcf';
  if (kb < 20)  return '#a6e22e';
  if (kb < 50)  return '#febc2e';
  if (kb < 100) return '#ff9933';
  return '#f87171';
}
export function renderFileBadge(name, bytes) {
  const color = sizeToColor(bytes);
  const kb = (bytes / 1024).toFixed(1);
  const html = '<span class="file-badge" style="background:' + color + '22;color:' + color + ';border:1px solid ' + color + ';padding:.1em .5em;border-radius:6px;">' + name + ' <small>' + kb + 'KB</small></span>';
  return html;
}
