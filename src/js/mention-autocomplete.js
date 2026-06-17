// @mention autocomplete popover.
//
// One singleton popover element shared by every textarea on the page —
// post composer, comment composer, quote modal, anything. Activates
// when the caret sits inside an `@token` (word-boundary-guarded so
// "test@example.com" doesn't trigger), shows up to 6 candidate
// handles ranked by prefix-match, and inserts "@handle " when picked.
//
// Local matches (allUsers cache + viewer's recent profile fetches)
// render instantly; a debounced searchProfiles() round trip fills in
// anyone the local cache doesn't know yet.

import { allUsers } from './data.js';
import { searchProfiles } from './profiles.js';
import { renderAvatar } from './avatar.js';

const SELECTOR = '.composer textarea, .comment-form textarea, .quote-form textarea';

let popoverEl   = null;
let activeTA    = null;   // textarea the popover is bound to right now
let candidates  = [];     // current list of profile objects
let activeIndex = -1;
let tokenRange  = null;   // { start, end, token } of the @… being typed
let remoteTimer = null;
let lastRemoteQ = '';

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function ensurePopover() {
  if (popoverEl) return popoverEl;
  popoverEl = document.createElement('div');
  popoverEl.className = 'mention-pop';
  popoverEl.hidden = true;
  popoverEl.setAttribute('role', 'listbox');
  document.body.appendChild(popoverEl);
  // Use mousedown (not click) so the textarea doesn't lose focus first
  // — losing focus before the click lands would close the popover
  // before the selection registers.
  popoverEl.addEventListener('mousedown', (e) => {
    const row = e.target.closest('.mention-pop__row');
    if (!row) return;
    e.preventDefault();
    const idx = Number(row.dataset.idx);
    if (Number.isFinite(idx)) commit(idx);
  });
  return popoverEl;
}

// Scan backwards from the caret to find an @token. Returns null when
// the caret isn't inside one (no @, @ has a word char before it, etc).
function getMentionToken(ta) {
  const value = ta.value;
  const pos   = ta.selectionStart;
  if (pos !== ta.selectionEnd) return null; // selection, not a caret
  let i = pos - 1;
  while (i >= 0) {
    const c = value[i];
    if (c === '@') {
      const prev = i === 0 ? '' : value[i - 1];
      // Word boundary on the left — same rule the inlineFormat
      // linkifier uses, so what gets linkified later matches what
      // we autocomplete now.
      if (i === 0 || /[^A-Za-z0-9_@-]/.test(prev)) {
        const token = value.slice(i + 1, pos);
        return { start: i, end: pos, token };
      }
      return null;
    }
    if (!/[A-Za-z0-9_-]/.test(c)) return null;
    i--;
  }
  return null;
}

function rankLocal(token) {
  const lower = token.toLowerCase();
  const all = Object.values(allUsers());
  return all
    .map(u => {
      const h = (u.handle || '').toLowerCase();
      const n = (u.name   || '').toLowerCase();
      let score = 0;
      if (!lower)                  score = 1;            // empty token → any
      else if (h === lower)        score = 100;
      else if (h.startsWith(lower)) score = 80;
      else if (n.startsWith(lower)) score = 50;
      else if (h.includes(lower))  score = 30;
      else if (n.includes(lower))  score = 20;
      return { u, score };
    })
    .filter(x => x.score > 0 && x.u.handle)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(x => x.u);
}

function dedupeMerge(local, remote) {
  const seen = new Set();
  const out  = [];
  for (const u of local.concat(remote)) {
    if (!u || !u.handle) continue;
    if (seen.has(u.handle)) continue;
    seen.add(u.handle);
    out.push(u);
    if (out.length >= 6) break;
  }
  return out;
}

function positionPopover(ta) {
  if (!popoverEl) return;
  const r = ta.getBoundingClientRect();
  // Anchor below the textarea, aligned to its left edge. Clamp inside
  // the viewport so the popover never spills off-screen on small phones.
  const top    = r.bottom + 4;
  const maxW   = Math.min(r.width, 320);
  const left   = Math.max(8, Math.min(r.left, window.innerWidth - maxW - 8));
  popoverEl.style.position = 'fixed';
  popoverEl.style.top   = top + 'px';
  popoverEl.style.left  = left + 'px';
  popoverEl.style.width = maxW + 'px';
}

function render() {
  ensurePopover();
  if (!candidates.length) { hide(); return; }
  popoverEl.innerHTML = candidates.map((u, i) => (
    '<button type="button" class="mention-pop__row' +
      (i === activeIndex ? ' is-active' : '') + '"' +
      ' data-idx="' + i + '" role="option">' +
      renderAvatar(u, { size: 'sm' }) +
      '<span class="mention-pop__text">' +
        '<span class="mention-pop__name">' + escape(u.name || u.handle) + '</span>' +
        '<span class="mention-pop__handle">@' + escape(u.handle) + '</span>' +
      '</span>' +
    '</button>'
  )).join('');
  popoverEl.hidden = false;
  if (activeTA) positionPopover(activeTA);
}

function hide() {
  if (popoverEl) popoverEl.hidden = true;
  candidates  = [];
  activeIndex = -1;
  tokenRange  = null;
  // Don't clear activeTA — it might still receive input.
}

function commit(idx) {
  const pick = candidates[idx];
  if (!pick || !activeTA || !tokenRange) { hide(); return; }
  const ta = activeTA;
  const before = ta.value.slice(0, tokenRange.start);
  const after  = ta.value.slice(tokenRange.end);
  const insert = '@' + pick.handle + ' ';
  ta.value = before + insert + after;
  const newPos = (before + insert).length;
  ta.setSelectionRange(newPos, newPos);
  // Fire input so auto-grow / draft-save / etc. pick up the change.
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  hide();
}

function refresh(ta) {
  if (!ta || !document.body.contains(ta)) { hide(); return; }
  if (!ta.matches(SELECTOR)) { hide(); return; }
  const range = getMentionToken(ta);
  if (!range) { hide(); return; }
  activeTA   = ta;
  tokenRange = range;
  candidates = rankLocal(range.token);
  activeIndex = candidates.length ? 0 : -1;
  render();
  // Debounced remote query for handles not in the local cache.
  if (range.token.length >= 1 && range.token !== lastRemoteQ) {
    lastRemoteQ = range.token;
    clearTimeout(remoteTimer);
    remoteTimer = setTimeout(async () => {
      let remote = [];
      try { remote = await searchProfiles(range.token, 6); } catch {}
      // Bail if the user has moved on or closed the popover.
      if (!tokenRange || tokenRange.token !== range.token) return;
      candidates = dedupeMerge(candidates, remote);
      if (activeIndex < 0 && candidates.length) activeIndex = 0;
      render();
    }, 180);
  }
}

document.addEventListener('input', (e) => {
  if (e.target instanceof HTMLTextAreaElement) refresh(e.target);
});
document.addEventListener('click', (e) => {
  // Click anywhere outside the popover / textarea closes it.
  if (popoverEl && popoverEl.contains(e.target)) return;
  if (e.target instanceof HTMLTextAreaElement && e.target.matches(SELECTOR)) {
    refresh(e.target);
    return;
  }
  hide();
});
document.addEventListener('keydown', (e) => {
  if (!popoverEl || popoverEl.hidden) return;
  if (e.target !== activeTA) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (candidates.length) {
      activeIndex = (activeIndex + 1) % candidates.length;
      render();
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (candidates.length) {
      activeIndex = (activeIndex - 1 + candidates.length) % candidates.length;
      render();
    }
  } else if ((e.key === 'Enter' || e.key === 'Tab') && !e.metaKey && !e.ctrlKey) {
    // Cmd/Ctrl+Enter is the "submit composer" shortcut — let it through.
    if (activeIndex >= 0) {
      e.preventDefault();
      e.stopPropagation();
      commit(activeIndex);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    hide();
  }
}, true); // capture, so Enter intercepts BEFORE the composer's submit
window.addEventListener('scroll', () => { if (activeTA) positionPopover(activeTA); }, true);
window.addEventListener('resize', () => { if (activeTA) positionPopover(activeTA); });

export function initMentionAutocomplete() {
  ensurePopover();
}
