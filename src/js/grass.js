const LEVELS = ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'];
function lv(n) { return n <= 0 ? 0 : n < 2 ? 1 : n < 4 ? 2 : n < 8 ? 3 : 4; }
export function renderGrass(counts) {
  const cell = 11, gap = 2;
  const cols = 53, rows = 7;
  const w = cols * (cell + gap), h = rows * (cell + gap);
  const cells = [];
  const today = new Date();
  for (let i = 0; i < cols * rows; i++) {
    const x = Math.floor(i / rows) * (cell + gap);
    const y = (i % rows) * (cell + gap);
    const d = new Date(today); d.setDate(d.getDate() - (cols * rows - 1 - i));
    const key = d.toISOString().slice(0, 10);
    const n = counts[key] || 0;
    cells.push('<rect x="' + x + '" y="' + y + '" width="' + cell + '" height="' + cell + '" rx="2" fill="' + LEVELS[lv(n)] + '"/>');
  }
  return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '">' + cells.join('') + '</svg>';
}
