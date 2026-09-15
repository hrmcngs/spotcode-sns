import { t } from './i18n.js';
const PRESETS = {
  active:    { bg: '#3ecfcf', fg: '#0d0d10', label: t("active") },
  wip:       { bg: '#febc2e', fg: '#0d0d10', label: t("WIP") },
  abandoned: { bg: '#888896', fg: '#0d0d10', label: t("abandoned") },
  released:  { bg: '#7c6af7', fg: '#ffffff', label: t("released") },
};
export function statusBadge(kind, label) {
  const p = PRESETS[kind] || PRESETS.wip;
  const text = label || p.label;
  return `<span class="status-badge" style="background:${p.bg};color:${p.fg};padding:.15em .55em;border-radius:6px;font-size:.78em;font-weight:700">${text}</span>`;
}
