// Edit-profile modal. Pre-fills with the current user, lets them
// change display name, avatar (image upload or 1-2 char fallback),
// avatar shape (round / square), bio, and location label.

import { currentUser, updateProfile, updatePassword } from '../auth.js';
import { icon }                       from '../icons.js';
import { fileToAvatarDataUrl, renderAvatar } from '../avatar.js';
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock.js';
import { linkGithub, unlinkGithub } from '../github-oauth.js';

let rootEl = null;
let stagedAvatarImage = undefined; // undefined = unchanged, '' = clear, 'data:...' = new
let stagedAvatarShape = null;

function attr(s) {
  return (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// GitHub linking via Supabase's built-in OAuth provider (see
// src/js/github-oauth.js + docs/github-oauth-setup.md). The button
// starts a redirect to github.com; on return, main.js calls
// syncGithubIdentity() which writes github_handle + github_verified
// into the profile row. This modal just needs to expose "link" and
// (when already linked) "unlink" affordances.
function githubVerifyBlock(u) {
  if (u.github?.verified && u.github?.handle) {
    return (
      '<div class="verify-row verify-row--ok" id="verify-row">' +
        '<div class="verify-row__title">' +
          icon('github', { size: 14, fill: true, className: 'icon--inline' }) +
          '@' + attr(u.github.handle) + ' と連携済み ✓' +
        '</div>' +
        '<div class="edit-actions">' +
          '<button type="button" class="btn btn--ghost btn--sm" id="verify-unlink">連携を解除</button>' +
          '<span class="verify-row__status" id="verify-status"></span>' +
        '</div>' +
      '</div>'
    );
  }
  return (
    '<div class="verify-row" id="verify-row">' +
      '<div class="verify-row__title">' +
        icon('github', { size: 14, fill: true, className: 'icon--inline' }) +
        'GitHub と連携' +
      '</div>' +
      '<p class="verify-row__hint">' +
        'GitHub OAuth で連携します。<code>read:user</code> のみ要求するので、あなたのリポジトリには一切アクセスしません。連携後、プロフィールに GitHub アイコンと本人確認済みバッジが付きます。' +
      '</p>' +
      '<div class="edit-actions">' +
        '<button type="button" class="btn btn--primary btn--sm" id="verify-link">' +
          icon('github', { size: 14, fill: true, className: 'icon--inline' }) +
          ' GitHub で連携する' +
        '</button>' +
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

          githubVerifyBlock(u) +

          '<div class="edit-actions">' +
            '<button type="button" class="btn btn--ghost" data-edit-close>Cancel</button>' +
            '<button type="submit" class="btn btn--primary">Save</button>' +
          '</div>' +
          '<p class="auth-error" data-error></p>' +
        '</form>' +

        // Password change — separate form so Save above stays a
        // single-purpose profile-fields write. Empty input + Save
        // does nothing; non-empty hits Supabase auth.updateUser.
        '<form class="auth-form" id="edit-password-form">' +
          '<label>パスワード変更 <span class="hint">(8 文字以上、変更しないなら空のまま)</span>' +
            '<input name="newPassword" type="password" minlength="8" ' +
              'autocomplete="new-password" placeholder="新しいパスワード">' +
          '</label>' +
          '<div class="edit-actions">' +
            '<button type="submit" class="btn btn--ghost btn--sm">パスワードを更新</button>' +
            '<span class="verify-row__status" data-password-status></span>' +
          '</div>' +
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

  // GitHub OAuth link / unlink. We wire the buttons once here, and
  // re-wire them again after every state flip since we swap the
  // #verify-row markup in place (link → linked, or vice-versa). No
  // page reload needed — refreshProfile() inside github-oauth.js
  // updates cachedUser, and we re-render just this section from the
  // fresh currentUser().
  function wireGithubButtons() {
    const vLink   = document.getElementById('verify-link');
    const vUnlink = document.getElementById('verify-unlink');
    const vStatus = document.getElementById('verify-status');
    function showVerify(msg, kind) {
      if (!vStatus) return;
      vStatus.textContent = msg || '';
      vStatus.className = 'verify-row__status' + (kind ? ' is-' + kind : '');
    }
    vLink?.addEventListener('click', async () => {
      vLink.disabled = true;
      showVerify('GitHub に移動します…');
      try {
        // Redirects the browser away — after return, syncGithubIdentity()
        // in main.js writes the profile row and refreshProfile() picks
        // it up so the next modal open shows the linked state.
        await linkGithub(window.location.href);
      } catch (ex) {
        showVerify(ex.message, 'bad');
        vLink.disabled = false;
      }
    });
    vUnlink?.addEventListener('click', async () => {
      if (!confirm('GitHub との連携を解除しますか？ アイコンと本人確認済みバッジが消えます。')) return;
      vUnlink.disabled = true;
      showVerify('解除中…');
      try {
        await unlinkGithub();
        // Swap the verify-row markup in place with the "not linked"
        // variant, then re-wire the fresh buttons. Avoids the
        // "reload to see change" UX.
        const row = document.getElementById('verify-row');
        if (row) {
          const wrap = document.createElement('div');
          wrap.innerHTML = githubVerifyBlock(currentUser() || {});
          row.replaceWith(wrap.firstElementChild);
          wireGithubButtons();
        }
      } catch (ex) {
        showVerify(ex.message, 'bad');
        vUnlink.disabled = false;
      }
    });
  }
  wireGithubButtons();

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

  // Password update — separate form, only fires when there's
  // something in the field. Empty submits are a no-op so the
  // user can hit Enter on it by mistake.
  const pwForm   = document.getElementById('edit-password-form');
  const pwStatus = pwForm?.querySelector('[data-password-status]');
  function showPw(msg, kind) {
    if (!pwStatus) return;
    pwStatus.textContent = msg || '';
    pwStatus.className = 'verify-row__status' + (kind ? ' is-' + kind : '');
  }
  pwForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = pwForm.querySelector('input[name="newPassword"]');
    const next = (input?.value || '').trim();
    if (!next) return;
    const submitBtn = pwForm.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    showPw('更新中…');
    try {
      await updatePassword(next);
      if (input) input.value = '';
      showPw('✓ パスワードを更新しました', 'ok');
    } catch (ex) {
      showPw(ex.message || String(ex), 'bad');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
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
