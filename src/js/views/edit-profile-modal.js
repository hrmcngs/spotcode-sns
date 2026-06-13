// Edit-profile modal. Pre-fills with the current user, lets them
// change display name, avatar (image upload or 1-2 char fallback),
// avatar shape (round / square), bio, and location label.

import { currentUser, updateProfile } from '../auth.js';
import { icon }                       from '../icons.js';
import { fileToAvatarDataUrl, renderAvatar } from '../avatar.js';
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock.js';
import { startVerification, confirmVerification, newRepoUrl, repoNameFor } from '../github-verify.js';

let rootEl = null;
let stagedAvatarImage = undefined; // undefined = unchanged, '' = clear, 'data:...' = new
let stagedAvatarShape = null;

function attr(s) {
  return (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function githubVerifyBlock(u) {
  if (u.github?.verified) {
    return (
      '<div class="verify-row verify-row--ok">' +
        icon('github', { size: 14, fill: true, className: 'icon--inline' }) +
        '@' + attr(u.github.handle) + ' は本人確認済み ✓' +
      '</div>'
    );
  }
  const existing = u.github?.verifyToken || '';
  const repoLink = existing ? newRepoUrl(existing) : '';
  return (
    '<div class="verify-row" id="verify-row">' +
      '<div class="verify-row__title">' +
        icon('github', { size: 14, fill: true, className: 'icon--inline' }) +
        'GitHub の本人確認' +
      '</div>' +
      '<p class="verify-row__hint">' +
        'コードを発行して、その名前のリポジトリを <a href="https://github.com/' + attr(u.github.handle) + '" target="_blank" rel="noopener">@' +
        attr(u.github.handle) + '</a> に作ってください。空でも構いません。確認後にリポジトリは削除して OK です（Bio は触りません）。' +
      '</p>' +
      '<div class="verify-row__token">' +
        '<code id="verify-token">' + attr(existing) + '</code>' +
        '<button type="button" class="btn btn--ghost btn--sm" id="verify-gen">' +
          (existing ? '新しいコード' : 'コードを発行') +
        '</button>' +
      '</div>' +
      '<div class="edit-actions">' +
        '<a class="btn btn--ghost btn--sm" id="verify-newrepo" target="_blank" rel="noopener" href="' +
          attr(repoLink) + '"' + (existing ? '' : ' hidden') + '>GitHub でリポジトリを作る</a>' +
        '<button type="button" class="btn btn--primary btn--sm" id="verify-confirm" ' +
          (existing ? '' : 'disabled') + '>確認</button>' +
        '<span class="verify-row__status" id="verify-status"></span>' +
      '</div>' +
    '</div>'
  );
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
          '<label>Display name <span class="hint">(画像未設定時のイニシャルは表示名の先頭文字)</span>' +
            '<input name="name" maxlength="40" value="' + attr(u.name) + '" required>' +
          '</label>' +
          '<label>Bio <span class="hint">(280 文字まで)</span>' +
            '<textarea name="bio" maxlength="280" rows="3">' + attr(u.bio || '') + '</textarea>' +
          '</label>' +
          '<label>Location' +
            '<input name="location" maxlength="60" value="' + attr(u.location || '') + '" placeholder="shibuya">' +
          '</label>' +
          '<label>Website' +
            '<input name="website" type="url" maxlength="200" value="' + attr(u.website || '') + '" placeholder="https://example.com" inputmode="url">' +
          '</label>' +
          '<label>Twitter / X <span class="hint">(@ なしのハンドルでも URL でも OK)</span>' +
            '<input name="twitter" maxlength="30" value="' + attr(u.twitter || '') + '" placeholder="hrmcngs">' +
          '</label>' +
          '<label>Instagram <span class="hint">(@ なしのハンドルでも URL でも OK)</span>' +
            '<input name="instagram" maxlength="30" value="' + attr(u.instagram || '') + '" placeholder="hrmcngs">' +
          '</label>' +

          (u.github?.handle ? githubVerifyBlock(u) : '') +

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
  if (!rootEl || rootEl.hidden) return;
  rootEl.hidden = true;
  unlockBodyScroll();
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

  // GitHub repo-name verification flow
  const vGen     = document.getElementById('verify-gen');
  const vConfirm = document.getElementById('verify-confirm');
  const vToken   = document.getElementById('verify-token');
  const vStatus  = document.getElementById('verify-status');
  const vNewRepo = document.getElementById('verify-newrepo');
  function showVerify(msg, kind) {
    if (!vStatus) return;
    vStatus.textContent = msg || '';
    vStatus.className = 'verify-row__status' + (kind ? ' is-' + kind : '');
  }
  vGen?.addEventListener('click', async () => {
    vGen.disabled = true;
    showVerify('発行中…');
    try {
      const t = await startVerification();
      if (vToken) vToken.textContent = t;
      if (vConfirm) vConfirm.disabled = false;
      if (vNewRepo) {
        vNewRepo.href = newRepoUrl(t);
        vNewRepo.hidden = false;
      }
      vGen.textContent = '新しいコード';
      showVerify('発行しました。「GitHub でリポジトリを作る」を押して、その名前のまま Create したら「確認」を押してください。', 'ok');
    } catch (ex) { showVerify(ex.message, 'bad'); }
    finally { vGen.disabled = false; }
  });
  vConfirm?.addEventListener('click', async () => {
    const u = currentUser();
    const handle = u?.github?.handle;
    const token  = vToken?.textContent?.trim();
    if (!handle || !token) { showVerify('コードを先に発行してください', 'bad'); return; }
    vConfirm.disabled = true;
    showVerify('@' + handle + '/' + repoNameFor(token) + ' を探しています…');
    try {
      await confirmVerification(handle, token);
      showVerify('✓ 本人確認できました。閉じてリロードしてください。', 'ok');
    } catch (ex) { showVerify(ex.message, 'bad'); }
    finally { vConfirm.disabled = false; }
  });

  // save
  const form = document.getElementById('edit-profile-form');
  const err  = form.querySelector('[data-error]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving…'; }
    try {
      const fd = new FormData(form);
      const patch = {
        name:      fd.get('name'),
        bio:       fd.get('bio'),
        location:  fd.get('location'),
        website:   fd.get('website'),
        twitter:   fd.get('twitter'),
        instagram: fd.get('instagram'),
        avatarShape: stagedAvatarShape,
      };
      if (stagedAvatarImage !== undefined) patch.avatarImage = stagedAvatarImage;
      await updateProfile(patch);
      close();
    } catch (ex) {
      err.textContent = ex.message || String(ex);
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save'; }
    }
  });

  document.addEventListener('keydown', function escClose(e) {
    if (e.key === 'Escape' && rootEl && !rootEl.hidden) {
      close();
      document.removeEventListener('keydown', escClose);
    }
  });

  rootEl.hidden = false;
  lockBodyScroll();
  setTimeout(() => form.querySelector('input[name="name"]')?.focus(), 30);
}
