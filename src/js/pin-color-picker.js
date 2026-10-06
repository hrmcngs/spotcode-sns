import { t } from './i18n.js';
import { normalizePinColor } from './display-prefs.js';

function hsvToHex(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] :
    h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [r, g, b].map(n => Math.round((n + m) * 255).toString(16).padStart(2, '0')).join('');
}

function hexToHsv(hex) {
  const v = normalizePinColor(hex).slice(1).match(/../g).map(x => parseInt(x, 16) / 255);
  const [r, g, b] = v;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  if (h < 0) h += 360;
  return { h, s: max ? d / max : 0, v: max };
}

export function pinColorButtonHtml(value, attrs = '', extraClass = '') {
  const color = normalizePinColor(value);
  return '<button type="button" class="pin-color-button' + (extraClass ? ' ' + extraClass : '') + '" style="--pin-color:' + color + '" data-pin-color-value="' + color + '" ' + attrs + '>' +
    '<span class="pin-color-button__swatch"></span><span>' + t('compose.pin_color') + '</span><code>' + color + '</code></button>';
}

export function openPinColorPicker(initial, onPick) {
  let hsv = hexToHsv(initial);
  const root = document.createElement('div');
  root.className = 'modal pin-color-modal';
  root.innerHTML =
    '<div class="modal__backdrop" data-pin-close></div>' +
    '<section class="modal__card pin-color-card" role="dialog" aria-modal="true" aria-labelledby="pin-color-title">' +
      '<header class="pin-color-head"><h2 id="pin-color-title">' + t('Colour picker') + '</h2><button type="button" data-pin-close aria-label="' + t('Close') + '">×</button></header>' +
      '<div class="pin-color-main"><div class="pin-color-preview"></div><div class="pin-color-field" data-pin-field><span data-pin-knob></span></div></div>' +
      '<input class="pin-color-hue" data-pin-hue type="range" min="0" max="359" value="' + Math.round(hsv.h) + '">' +
      '<label class="pin-color-hex"><span>HEX</span><input data-pin-hex spellcheck="false" autocomplete="off"></label>' +
      '<div class="pin-color-actions"><button type="button" class="btn btn--ghost" data-pin-close>' + t('common.cancel') + '</button><button type="button" class="btn btn--primary" data-pin-apply>' + t('common.save') + '</button></div>' +
    '</section>';
  document.body.appendChild(root);
  const field = root.querySelector('[data-pin-field]');
  const knob = root.querySelector('[data-pin-knob]');
  const hue = root.querySelector('[data-pin-hue]');
  const hex = root.querySelector('[data-pin-hex]');
  const preview = root.querySelector('.pin-color-preview');
  const sync = () => {
    const color = hsvToHex(hsv.h, hsv.s, hsv.v);
    field.style.setProperty('--pin-hue', hsvToHex(hsv.h, 1, 1));
    knob.style.left = (hsv.s * 100) + '%';
    knob.style.top = ((1 - hsv.v) * 100) + '%';
    preview.style.background = color;
    hex.value = color;
  };
  const pickField = (event) => {
    const rect = field.getBoundingClientRect();
    hsv.s = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    hsv.v = 1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    sync();
  };
  field.addEventListener('pointerdown', (event) => {
    field.setPointerCapture(event.pointerId);
    pickField(event);
  });
  field.addEventListener('pointermove', (event) => {
    if (field.hasPointerCapture(event.pointerId)) pickField(event);
  });
  hue.addEventListener('input', () => { hsv.h = Number(hue.value) || 0; sync(); });
  hex.addEventListener('change', () => { hsv = hexToHsv(hex.value); hue.value = Math.round(hsv.h); sync(); });
  const close = () => root.remove();
  root.querySelectorAll('[data-pin-close]').forEach(el => el.addEventListener('click', close));
  root.querySelector('[data-pin-apply]').addEventListener('click', () => {
    onPick(normalizePinColor(hex.value));
    close();
  });
  sync();
  hex.focus();
  hex.select();
}
