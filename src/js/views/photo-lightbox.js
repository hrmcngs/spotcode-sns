// Tap-a-post-photo → fullscreen lightbox with pinch / wheel zoom and
// swipe-to-dismiss. One singleton element shared across the whole app
// — open() injects it on first call, then reuses it. Operates only on
// data URLs / image URLs, no DOM scraping.

import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock.js';

let rootEl  = null;
let imgEl   = null;
let photos  = [];
let index   = 0;

// Current transform — scale + translate inside the image area.
let scale  = 1;
let tx     = 0;
let ty     = 0;
const MIN_SCALE = 1;
const MAX_SCALE = 5;

function ensure() {
  if (rootEl) return;
  rootEl = document.createElement('div');
  rootEl.className = 'lightbox';
  rootEl.hidden = true;
  rootEl.innerHTML =
    '<div class="lightbox__backdrop" data-lb-close></div>' +
    '<button type="button" class="lightbox__close" data-lb-close aria-label="閉じる">×</button>' +
    '<button type="button" class="lightbox__nav lightbox__nav--prev" data-lb-prev aria-label="前へ">‹</button>' +
    '<button type="button" class="lightbox__nav lightbox__nav--next" data-lb-next aria-label="次へ">›</button>' +
    '<div class="lightbox__stage" data-lb-stage>' +
      '<img class="lightbox__img" alt="">' +
    '</div>' +
    '<div class="lightbox__counter" data-lb-counter></div>';
  document.body.appendChild(rootEl);
  imgEl = rootEl.querySelector('.lightbox__img');

  rootEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-lb-close]')) { close(); return; }
    if (e.target.closest('[data-lb-prev]'))  { step(-1); return; }
    if (e.target.closest('[data-lb-next]'))  { step(+1); return; }
  });

  // Pinch zoom via Pointer Events — works on touch + trackpad.
  // Fallback to wheel for desktop.
  const stage = rootEl.querySelector('[data-lb-stage]');
  let pointers = new Map();
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  let panLast = null;

  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      pinchStartScale = scale;
    } else if (pointers.size === 1) {
      panLast = { x: e.clientX, y: e.clientY };
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      setScale(pinchStartScale * (dist / pinchStartDist));
    } else if (pointers.size === 1 && scale > 1 && panLast) {
      tx += e.clientX - panLast.x;
      ty += e.clientY - panLast.y;
      panLast = { x: e.clientX, y: e.clientY };
      applyTransform();
    }
  });
  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStartDist = 0;
    if (pointers.size === 0) panLast = null;
  }
  stage.addEventListener('pointerup',     endPointer);
  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener('pointerleave',  endPointer);

  // Mouse wheel — trackpad pinch arrives as Ctrl+wheel events on mac.
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.0025;
    setScale(scale * (1 + delta));
  }, { passive: false });

  // Double-tap / double-click to toggle 2x.
  stage.addEventListener('dblclick', () => {
    setScale(scale > 1 ? 1 : 2);
    if (scale === 1) { tx = 0; ty = 0; applyTransform(); }
  });

  // Keyboard: arrows for next/prev, Esc to close.
  document.addEventListener('keydown', (e) => {
    if (!rootEl || rootEl.hidden) return;
    if (e.key === 'Escape')     { e.preventDefault(); close(); }
    else if (e.key === 'ArrowLeft')  { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(+1); }
  });
}

function setScale(next) {
  const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next));
  scale = clamped;
  if (scale === 1) { tx = 0; ty = 0; }
  applyTransform();
}
function applyTransform() {
  if (!imgEl) return;
  imgEl.style.transform =
    'translate(' + tx + 'px, ' + ty + 'px) scale(' + scale + ')';
}

function show(i) {
  index = (i + photos.length) % photos.length;
  scale = 1; tx = 0; ty = 0; applyTransform();
  imgEl.src = photos[index];
  const counter = rootEl.querySelector('[data-lb-counter]');
  if (counter) counter.textContent = photos.length > 1 ? (index + 1) + ' / ' + photos.length : '';
  // Hide nav arrows if there's only one photo.
  const single = photos.length <= 1;
  rootEl.querySelectorAll('.lightbox__nav').forEach(btn => btn.hidden = single);
}
function step(d) { show(index + d); }

export function openLightbox(list, startIndex = 0) {
  if (!list || !list.length) return;
  ensure();
  photos = list.slice();
  rootEl.hidden = false;
  lockBodyScroll();
  show(startIndex);
}
function close() {
  if (!rootEl) return;
  rootEl.hidden = true;
  imgEl.src = '';
  photos = [];
  unlockBodyScroll();
}
