// Edit-profile modal. Pre-fills with the current user, lets them
// change display name, avatar letter(s), bio, and location label.

import { currentUser, updateProfile } from '../auth.js';
import { icon }                       from '../icons.js';

let rootEl = null;

function template(u) {
  const v = (s) => (s == null ? '' : String(s)).replace(/"/g, '&quot;');
  return (
    '<div class="modal" id="edit-profile-modal" hidden>' +
      '<div class="modal__backdrop" data-edit-close></div>' +
      '<div class="modal__card" role="dialog" aria-labelledby="edit-title">' +
        '<button class="modal__close" data-edit-close aria-label="Close">' + icon('close', { size: 18 }) + '</button>' +
        '<h2 id="edit-title" class="auth-form__h">Edit profile</h2>' +

        '<form class="auth-form" id="edit-profile-form">' +
          '<label>Display name' +
            '<input name="name" maxlength="40" value="' + v(u.name) + '" required>' +
          '</label>' +
          '<label>Avatar <span class="hint">(1〜2 文字)</span>' +
            '<input name="avatar" maxlength="2" value="' + v(u.avatar) + '" placeholder="H">' +
          '</label>' +
          '<label>Bio <span class="hint">(280 文字まで)</span>' +
            '<textarea name="bio" maxlength="280" rows="3">' + v(u.bio || '') + '</textarea>' +
          '</label>' +
          '<label>Location' +
            '<input name="location" maxlength="60" value="' + v(u.location || '') + '" placeholder="shibuya">' +
          '</label>' +

          '<div class="edit-actions">' +
            '<button type="button" class="btn btn--ghost" data-edit-close>Cancel</button>' +
            '<button type="submit" class="btn btn--primary">Save</button>' +
          '</div>' +
          '<p class="auth-error" data-error></p>' +
        '</form>' +
      '</div>' +
    '</div>'
  );
}

function close() {
  if (!rootEl) return;
  rootEl.hidden = true;
}

export function openEditProfile() {
  const u = currentUser();
  if (!u) return;

  // Rebuild from scratch so the form reflects the latest user state.
  if (rootEl) rootEl.remove();
  const host = document.createElement('div');
  host.innerHTML = template(u);
  document.body.appendChild(host.firstElementChild);
  rootEl = document.getElementById('edit-profile-modal');

  rootEl.addEventListener('click', (e) => {
    if (e.target.matches('[data-edit-close]')) close();
  });

  const form = document.getElementById('edit-profile-form');
  const err  = form.querySelector('[data-error]');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    err.textContent = '';
    const fd = new FormData(form);
    try {
      updateProfile({
        name:     fd.get('name'),
        avatar:   fd.get('avatar'),
        bio:      fd.get('bio'),
        location: fd.get('location'),
      });
      close();
    } catch (ex) { err.textContent = ex.message || String(ex); }
  });

  document.addEventListener('keydown', function escClose(e) {
    if (e.key === 'Escape' && rootEl && !rootEl.hidden) {
      close();
      document.removeEventListener('keydown', escClose);
    }
  });

  rootEl.hidden = false;
  setTimeout(() => form.querySelector('input[name="name"]')?.focus(), 30);
}
