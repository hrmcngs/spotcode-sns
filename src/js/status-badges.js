// GitHub バッジ風のステータス表示。
const PRESETS = {
  active:    { bg: "#3ecfcf", fg: "#0d0d10", label: "active" },
  wip:       { bg: "#febc2e", fg: "#0d0d10", label: "WIP" },
  abandoned: { bg: "#888896", fg: "#0d0d10", label: "abandoned" },
  released:  { bg: "#7c6af7", fg: "#ffffff", label: "released" },
};
export function statusBadge(kind, label) {
  const p = PRESETS[kind] || PRESETS.wip;
  return ;
}
