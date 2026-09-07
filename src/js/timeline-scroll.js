// Re-check after appending a page as well as on scrolling. This also works
// in embedded browsers without IntersectionObserver.
export function watchTimelineEnd(element, { active, load }) {
  let stopped = false, frame = null;
  const stop = () => {
    stopped = true;
    observer?.disconnect();
    if (frame !== null) cancelAnimationFrame(frame);
    document.removeEventListener('scroll', schedule, true);
    window.removeEventListener('resize', schedule);
  };
  const check = () => {
    frame = null;
    if (stopped) return;
    if (!active() || !element.isConnected) { stop(); return; }
    const bounds = element.getBoundingClientRect();
    if (!element.hidden && bounds.top <= window.innerHeight + 300 && bounds.bottom >= 0) load();
  };
  function schedule() {
    if (!stopped && frame === null) frame = requestAnimationFrame(check);
  }
  const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(schedule, { rootMargin: '300px' });
  observer?.observe(element);
  document.addEventListener('scroll', schedule, { passive: true, capture: true });
  window.addEventListener('resize', schedule);
  schedule();
  return { check: schedule, disconnect: stop };
}
