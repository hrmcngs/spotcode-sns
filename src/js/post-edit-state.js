// Keep working copies across timeline/detail renders, scoped to the account.
// Only Save sends these changes to the server; Cancel drops the working copy.
export function installPostEditState(root, owner) {
  const drafts = new Map();
  let account = owner();
  const syncAccount = () => {
    if (account !== owner()) { drafts.clear(); account = owner(); return false; }
    return true;
  };
  const capture = () => {
    if (!syncAccount()) return;
    for (const card of root.querySelectorAll('.post[data-post-id]')) {
      const body = card.querySelector('.post__body');
      if (!body?.querySelector('.post__edit-input')) continue;
      const copy = body.cloneNode(true);
      copy.querySelectorAll('[disabled]').forEach(el => el.removeAttribute('disabled'));
      const values = [...body.querySelectorAll('input, textarea, select')].map(el => el.value);
      drafts.set(card.dataset.postId, { html: copy.innerHTML, original: body.dataset.originalHtml, values });
    }
  };
  const restore = () => {
    if (!syncAccount()) return;
    for (const card of root.querySelectorAll('.post[data-post-id]')) {
      const draft = drafts.get(card.dataset.postId);
      const body = card.querySelector('.post__body');
      if (!draft || !body || body.querySelector('.post__edit-input')) continue;
      body.innerHTML = draft.html;
      body.dataset.originalHtml = draft.original;
      body.querySelectorAll('input, textarea, select').forEach((el, i) => { el.value = draft.values[i]; });
    }
    capture();
  };
  const observer = new MutationObserver(restore);
  observer.observe(root, { childList: true, subtree: true });
  root.addEventListener('input', capture);
  root.addEventListener('change', capture);
  // Kind pills change classes/attributes in the delegated document handler.
  root.addEventListener('click', () => queueMicrotask(capture));
  return {
    capture,
    forget(id) { drafts.delete(id); },
  };
}
