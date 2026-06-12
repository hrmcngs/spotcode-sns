// Helpers for rendering avatars consistently and for processing uploads.
//
// A user may carry:
//   user.avatar       — 1-2 char letter fallback
//   user.avatarImage  — base64 data: URL of an uploaded image (optional)
//   user.avatarShape  — 'round' (default) | 'square'

function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// Build an avatar element. Call sites stay decoupled from how the user
// stores their picture/shape — they just pass the user object.
//
//   tag    'div' (default) or 'a'
//   href   only used when tag === 'a'
//   size   'lg' | 'xl' | 'me' (without prefix)
//   title  tooltip
//   extra  extra class names
export function renderAvatar(user, {
  tag = 'div', href = '', size = '', title = '', extra = '',
} = {}) {
  const cls = ['avatar'];
  if (size) cls.push('avatar--' + size);
  if (user && user.avatarShape === 'square') cls.push('avatar--square');
  if (extra) cls.push(extra);

  const img = user && user.avatarImage;
  const inner = img ? '' : escapeAttr(user?.avatar || '?');
  const style = img
    ? ' style="background-image:url(\'' + img + '\');background-size:cover;background-position:center;color:transparent"'
    : '';

  const opening = tag === 'a'
    ? '<a class="' + cls.join(' ') + '" href="' + escapeAttr(href) + '"' +
        (title ? ' title="' + escapeAttr(title) + '"' : '') + style + '>'
    : '<' + tag + ' class="' + cls.join(' ') + '"' +
        (title ? ' title="' + escapeAttr(title) + '"' : '') + style + '>';

  return opening + inner + '</' + tag + '>';
}

// Read a File and resize it to a max edge of `max` px, returning a
// JPEG (lossy, small) data URL. Resizing avoids blowing the localStorage
// quota with a multi-megapixel phone photo.
export async function fileToAvatarDataUrl(file, max = 256) {
  if (!file) throw new Error('NO_FILE');
  if (!/^image\//.test(file.type)) throw new Error('NOT_IMAGE');
  if (file.size > 8 * 1024 * 1024) throw new Error('TOO_LARGE'); // 8MB pre-resize cap

  const src = await readAsDataUrl(file);
  const img = await loadImage(src);

  const ratio = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width  * ratio));
  const h = Math.max(1, Math.round(img.height * ratio));
  const canvas = document.createElement('canvas');
  canvas.width  = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  // JPEG quality .85 keeps the data URL well under ~50KB at 256px square.
  return canvas.toDataURL('image/jpeg', 0.85);
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('IMAGE_DECODE'));
    img.src = src;
  });
}
