// URL safety helpers. User-supplied URLs land in three places that
// can cause script execution if we trust them naively:
//   • `<a href="...">`            — `javascript:` runs on click
//   • `<img src="...">`           — data: URLs that aren't images
//   • `style="background-image:url('...')"` — CSS injection escape
//     out of the url() literal then attacker-controlled rules
//
// Centralising the scheme allowlist + escape rules so individual
// renderers don't have to remember.

// http(s), mailto, tel, or relative ("/...", "#...", "?...").
const SAFE_LINK = /^(?:https?:|mailto:|tel:|\/|#|\?)/i;

// Only image data URLs and http(s) image sources. data: URLs MUST
// specify an image MIME so a content sniff can't be tricked into
// running text/html with `<script>` payload.
const SAFE_IMAGE = /^(?:https?:\/\/|data:image\/(?:jpeg|jpg|png|gif|webp|svg\+xml);)/i;

/**
 * Return `url` if it's safe for use in an <a href>, else null.
 * `null` lets callers decide whether to drop the link entirely or
 * render the text without a wrapping <a>.
 */
export function safeLinkUrl(url) {
  if (url == null) return null;
  const s = String(url).trim();
  if (!s) return null;
  return SAFE_LINK.test(s) ? s : null;
}

/**
 * Return `url` if it's safe for use in an <img src> or CSS url(),
 * else null. Stricter than safeLinkUrl — only http(s) and image
 * data URLs allowed.
 */
export function safeImageUrl(url) {
  if (url == null) return null;
  const s = String(url).trim();
  if (!s) return null;
  return SAFE_IMAGE.test(s) ? s : null;
}

/**
 * Escape a (already-safe) URL for use inside a CSS url('...') literal.
 * Without this, a closing quote in the URL would let an attacker break
 * out of the literal and inject arbitrary CSS rules.
 *
 * data: URLs from the canvas pipeline never contain single quotes,
 * but viewer-supplied avatar/photo URLs in the future might, so do
 * the encode unconditionally.
 */
export function cssUrlValue(url) {
  return String(url)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\A ')
    .replace(/\r/g, '\\D ');
}
