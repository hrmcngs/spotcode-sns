// GitHub 風の活動 heatmap。日付 → 投稿数 のマップを SVG で 53週分描画する。
const LEVELS = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"];
function lv(n) { return n <= 0 ? 0 : n < 2 ? 1 : n < 4 ? 2 : n < 8 ? 3 : 4; }
export function renderGrass(counts) {
  const cell = 11, gap = 2;
  const w = 53 * (cell + gap), h = 7 * (cell + gap);
  let svg = ;
  const today = new Date();
  for (let i = 0; i < 53 * 7; i++) {
    const x = Math.floor(i / 7) * (cell + gap);
    const y = (i % 7) * (cell + gap);
    const d = new Date(today); d.setDate(d.getDate() - (53 * 7 - 1 - i));
    const key = d.toISOString().slice(0, 10);
    const n = counts[key] || 0;
    svg += ;
  }
  return svg + ;
}
