// Small stroke-based icon set. Designed at 24x24, scaled by CSS via .icon class.
const PATHS = {
  home:     '<path d="M3 12 L12 4 L21 12 M5 10 V20 H9 V14 H15 V20 H19 V10"/>',
  search:   '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  compass:  '<circle cx="12" cy="12" r="9"/><polygon points="16,8 12,14 8,16 12,10"/>',
  pin:      '<path d="M12 22s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12z"/><circle cx="12" cy="10" r="3"/>',
  repo:     '<path d="M6 3v15a3 3 0 0 0 3 3h11V6H9a3 3 0 0 1-3-3z"/><path d="M6 18a3 3 0 0 1 3-3h11"/>',
  bell:     '<path d="M15 17H9a2 2 0 0 1-2-2v-3a5 5 0 1 1 10 0v3a2 2 0 0 1-2 2zM10 21h4"/>',
  user:     '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/>',
  reply:    '<path d="M21 12a8 8 0 0 1-8 8c-1.5 0-2.9-.4-4.1-1.2L3 21l1.2-5.9A8 8 0 1 1 21 12z"/>',
  fork:     '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="20" r="2"/><path d="M6 8v2a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8M12 14v4"/>',
  star:     '<path d="M12 3l2.8 5.7 6.2 1-4.5 4.4 1 6.2L12 17.4 6.5 20.3l1-6.2L3 9.7l6.2-1z"/>',
  heart:    '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>',
  share:    '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v14"/>',
  plus:     '<path d="M12 5v14M5 12h14"/>',
  close:    '<path d="M6 6l12 12M18 6L6 18"/>',
  moon:     '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  image:    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  code:     '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  chart:    '<line x1="5" y1="20" x2="5" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="19" y1="20" x2="19" y2="14"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="16" y1="3" x2="16" y2="7"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="3" y1="11" x2="21" y2="11"/>',
  github:   '<path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.4-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.7.4-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-4.9 0-1.1.4-2 1-2.7-.1-.3-.5-1.3.1-2.7 0 0 .9-.3 2.8 1 .8-.2 1.7-.3 2.5-.3.9 0 1.7.1 2.5.3 1.9-1.3 2.8-1 2.8-1 .6 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.3 4.7-4.6 4.9.4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10 10 0 0 0 12 2z"/>',
  instagram:'<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor"/>',
  twitter:  '<path d="M3 3l7.5 10L3.5 21H6l5.5-6 4.5 6H21l-8-10.5L20.5 3H18l-5 5.5L9 3z"/>',
  globe:    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  send:     '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  spark:    '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
  gear:     '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  flag:     '<path d="M4 22V4M4 4h14l-3 5 3 5H4"/>',
  trash:    '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  at:       '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
  pencil:   '<path d="M4 20h4L20 8l-4-4L4 16v4z"/><path d="M14 6l4 4"/>',
  lock:     '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  arrow_right: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="1"/><line x1="9" y1="7" x2="9.01" y2="7"/><line x1="15" y1="7" x2="15.01" y2="7"/><line x1="9" y1="11" x2="9.01" y2="11"/><line x1="15" y1="11" x2="15.01" y2="11"/><line x1="9" y1="15" x2="9.01" y2="15"/><line x1="15" y1="15" x2="15.01" y2="15"/>',
  users:    '<circle cx="9" cy="8" r="3.5"/><path d="M2 21v-1a7 7 0 0 1 14 0v1"/><path d="M16 4a3.5 3.5 0 0 1 0 7"/><path d="M22 21v-1a7 7 0 0 0-5-6.7"/>',
};

export function icon(name, opts = {}) {
  const size  = opts.size  || 20;
  const cls   = ['icon', opts.className].filter(Boolean).join(' ');
  const stroke = opts.fill ? 'currentColor' : 'currentColor';
  const fillAttr = opts.fill ? 'fill="currentColor" stroke="none"' : 'fill="none" stroke="currentColor"';
  const path  = PATHS[name];
  if (!path) return '';
  return '<svg class="' + cls + '" viewBox="0 0 24 24" width="' + size + '" height="' + size +
    '" ' + fillAttr + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    path + '</svg>';
}
