// Lock the body scroll while a modal is open. iOS Safari ignores
// `overflow: hidden` on body — the user can still scroll the timeline
// behind the modal — so we have to pin the body with position: fixed
// and remember the scroll position to restore on unlock.
//
// Refcounted so multiple modals stacked on top of each other (e.g.
// edit profile → re-auth) only unlock once the outermost closes.

let depth = 0;
let savedScrollY = 0;

export function lockBodyScroll() {
  depth += 1;
  if (depth > 1) return;
  savedScrollY = window.scrollY || window.pageYOffset || 0;
  const b = document.body;
  b.style.position = 'fixed';
  b.style.top      = '-' + savedScrollY + 'px';
  b.style.left     = '0';
  b.style.right    = '0';
  b.style.width    = '100%';
  b.classList.add('modal-open');
}

export function unlockBodyScroll() {
  if (depth === 0) return;
  depth -= 1;
  if (depth > 0) return;
  const b = document.body;
  b.style.position = '';
  b.style.top      = '';
  b.style.left     = '';
  b.style.right    = '';
  b.style.width    = '';
  b.classList.remove('modal-open');
  window.scrollTo(0, savedScrollY);
  savedScrollY = 0;
}
