// iOS Safari / WKWebView safety net.
//
// CSS already floors form-control font-size to 16px so focus shouldn't
// trigger the auto-zoom. But if the user lands in a zoomed state for any
// other reason (double-tap on a button, accessibility setting, a rule that
// snuck under the floor, leftover from an old SW cache), this listener
// snaps the viewport back to scale 1 once they blur the input.
//
// Trick: temporarily set `maximum-scale=1` in the viewport meta. iOS Safari
// honors that by immediately resetting the visible scale to 1. Restore the
// pinch-zoom-allowed meta 300 ms later so manual zoom keeps working.

const BASE_VP = 'width=device-width, initial-scale=1, viewport-fit=cover';
const LOCK_VP = 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover';

let pending = false;

function resetZoom() {
  // Only intervene when we're actually zoomed in. If the user is at scale
  // 1 we'd be needlessly disabling pinch zoom for the next 300 ms.
  const vv = window.visualViewport;
  if (vv && vv.scale <= 1.02) return;

  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta || pending) return;
  pending = true;
  meta.setAttribute('content', LOCK_VP);
  setTimeout(() => {
    meta.setAttribute('content', BASE_VP);
    pending = false;
  }, 300);
}

export function initIosZoomGuard() {
  // The auto-zoom bug is iOS-only; desktop browsers don't need the
  // listener, so skip the no-op cost there.
  if (!/iPad|iPhone|iPod/.test(navigator.userAgent)) return;

  // After an input blurs, iOS often leaves the page zoomed.
  document.addEventListener('focusout', (e) => {
    const t = e.target;
    if (t && t.matches && t.matches('input, textarea, select')) {
      // Delay one frame so the keyboard hide animation doesn't fight us.
      requestAnimationFrame(resetZoom);
    }
  });

  // Cover the case where the user comes back from a different tab /
  // background and the WKWebView restored a zoomed state.
  window.addEventListener('pageshow', resetZoom);
}
