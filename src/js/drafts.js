// Composer drafts — pure localStorage so it keeps working offline.
//
// One slot per user (Twitter / X style). Logged-out users share a single
// "guest" slot so a draft written before signing in survives the auth
// modal round-trip.
//
// Shape: { body, githubLink, spot, savedAt }
//   - body:       string (textarea contents)
//   - githubLink: string | ''
//   - spot:       { lat, lng, label, address?, addressDetails? } | null
//   - savedAt:    epoch ms (used by the "Draft restored · 5m ago" hint)

const PREFIX = 'spotcode:draft:';

function keyFor(handle) {
  return PREFIX + (handle || '_guest');
}

export function saveDraft(handle, draft) {
  if (!draft) return;
  const body = (draft.body || '').trim();
  const link = (draft.githubLink || '').trim();
  const spot = draft.spot || null;
  // Don't persist a draft that has nothing in it — clear instead so
  // the "Draft restored" banner doesn't appear on an empty form.
  if (!body && !link && !spot) {
    clearDraft(handle);
    return;
  }
  try {
    localStorage.setItem(keyFor(handle), JSON.stringify({
      body, githubLink: link, spot, savedAt: Date.now(),
    }));
  } catch {}
}

export function loadDraft(handle) {
  try {
    const raw = localStorage.getItem(keyFor(handle));
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object') return null;
    return v;
  } catch { return null; }
}

export function clearDraft(handle) {
  try { localStorage.removeItem(keyFor(handle)); } catch {}
}

export function hasDraft(handle) {
  return loadDraft(handle) != null;
}

// Tiny debounce so the input handler can call saveDraft on every
// keystroke without thrashing localStorage.
export function debounce(fn, ms) {
  let t = 0;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}
