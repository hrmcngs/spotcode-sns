// Edit-profile modal. Pre-fills with the current user, lets them
// change display name, avatar (image upload or 1-2 char fallback),
// avatar shape (round / square), bio, and location label.

import { currentUser, updateProfile } from '../auth.js';
import { icon }                       from '../icons.js';
import { fileToAvatarDataUrl, renderAvatar } from '../avatar.js';

let rootEl = null;
let stagedAvatarImage = undefined; // undefined = unchanged, '' = clear, 'data:...' = new
let stagedAvatarShape = null;

function attr(s) {
  return (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function template(u) {
  return (
    '<div class="modal" id="edit-profile-modal" hidden>' +
      '<div class="modal__backdrop" data-edit-close></div>' +
      '<div class="modal__card" role="dialog" aria-labelledby="edit-title">' +
        '<button class="modal__close" data-edit-close aria-label="Close">' + icon('close', { size: 18 }) + '</button>' +
        '<h2 id="edit-title" class="auth-form__h">Edit profile</h2>' +

        '<div class="avatar-edit">' +
          '<div class="avatar-edit__preview" id="avatar-preview">' +
            renderAvatar(u, { size: 'xl' }) +
          '</div>' +
          '<div class="avatar-edit__controls">' +
            '<label class="btn btn--ghost btn--sm">' +
              '画像をアップロード' +
              '<input type="file" id="avatar-file" accept="image/*" hidden>' +
            '</label>' +
            (u.avatarImage
              ? '<button type="button" class="btn btn--ghost btn--sm" id="avatar-clear">画像を消す</button>'
              : '') +
            '<div class="avatar-shape">' +
              '<label class="shape-opt"><input type="radio" name="shape" value="round"' +
                (u.avatarShape !== 'square' ? ' checked' : '') + '><span>● 円</span></label>' +
              '<label class="shape-opt"><input type="radio" name="shape" value="square"' +
                (u.avatarShape === 'square' ? ' checked' : '') + '><span>■ 角丸</span></label>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<form class="auth-form" id="edit-profile-form">' +
          '<label>Display name' +
            '<input name="name" maxlength="40" value="' + attr(u.name) + '" required>' +
          '</label>' +
          '<label>Initials <span class="hint">(画像未設定時に表示・1〜2 文字)</span>' +
            '<input name="avatar" maxlength="2" value="' + attr(u.avatar) + '" placeholder="H">' +
          '</label>' +
          '<label>Bio <span class="hint">(280 文字まで)</span>' +
            '<textarea name="bio" maxlength="280" rows="3">' + attr(u.bio || '') + '</textarea>' +
          '</label>' +
          '<label>Location' +
            '<input name="location" maxlength="60" value="' + attr(u.location || '') + '" placeholder="shibuya">' +
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

function setPreview(userLike) {
  const slot = document.getElementById('avatar-preview');
  if (slot) slot.innerHTML = renderAvatar(userLike, { size: 'xl' });
}

export function openEditProfile() {
  const u = currentUser();
  if (!u) return;

  stagedAvatarImage = undefined;
  stagedAvatarShape = u.avatarShape || 'round';

  if (rootEl) rootEl.remove();
  const host = document.createElement('div');
  host.innerHTML = template(u);
  document.body.appendChild(host.firstElementChild);
  rootEl = document.getElementById('edit-profile-modal');

  rootEl.addEventListener('click', (e) => {
    if (e.target.matches('[data-edit-close]')) close();
  });

  // file upload
  const fileInput = document.getElementById('avatar-file');
  fileInput.addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const err = document.querySelector('#edit-profile-form [data-error]');
    err.textContent = '';
    try {
      const dataUrl = await fileToAvatarDataUrl(f, 256);
      stagedAvatarImage = dataUrl;
      setPreview({ ...u, avatarImage: dataUrl, avatarShape: stagedAvatarShape });
    } catch (ex) {
      const map = {
        NOT_IMAGE:    '画像ファイルを選んでください',
        TOO_LARGE:    '8MB 以上のファイルは扱えません',
        IMAGE_DECODE: '画像のデコードに失敗しました',
      };
      err.textContent = map[ex.message] || ex.message;
    } finally {
      fileInput.value = '';
    }
  });

  // clear image
  document.getElementById('avatar-clear')?.addEventListener('click', () => {
    stagedAvatarImage = '';
    setPreview({ ...u, avatarImage: undefined, avatarShape: stagedAvatarShape });
  });

  // shape radios — live update the preview
  rootEl.querySelectorAll('input[name="shape"]').forEach((r) => {
    r.addEventListener('change', () => {
      stagedAvatarShape = rootEl.querySelector('input[name="shape"]:checked').value;
      const previewUser = {
        ...u,
        avatarImage: stagedAvatarImage === undefined ? u.avatarImage : (stagedAvatarImage || undefined),
        avatarShape: stagedAvatarShape,
      };
      setPreview(previewUser);
    });
  });

  // save
  const form = document.getElementById('edit-profile-form');
  const err  = form.querySelector('[data-error]');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    err.textContent = '';
    const fd = new FormData(form);
    try {
      const patch = {
        name:     fd.get('name'),
        avatar:   fd.get('avatar'),
        bio:      fd.get('bio'),
        location: fd.get('location'),
        avatarShape: stagedAvatarShape,
      };
      if (stagedAvatarImage !== undefined) patch.avatarImage = stagedAvatarImage;
      updateProfile(patch);
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
