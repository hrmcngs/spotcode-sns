// Twitter-style composer. Disabled state when logged out. Spot is optional —
// the chip says "場所を追加" and only flips to a real spot once the user picks one.
//
// The body textarea has a visible bottom rule so users can clearly see where
// to type, and the optional GitHub URL field is collapsed behind a "+ Link"
// button to keep the main row from looking like a second text input.

import { icon } from './icons.js';
import { renderAvatar } from './avatar.js';

export function renderIdeaForm({ user = null } = {}) {
  if (!user) {
    return (
      '<div class="composer composer--gated">' +
        '<div class="composer-gate">' +
          '<div class="composer-gate__title">アイデアを投稿するにはサインインしてください</div>' +
          '<div class="composer-gate__actions">' +
            '<button class="btn btn--ghost" data-auth="login">Log in</button>' +
            '<button class="btn btn--primary" data-auth="register">Sign up</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  return (
    '<div class="composer">' +
      renderAvatar(user, { size: 'lg' }) +
      '<form class="idea-form">' +
        '<div class="composer-body">' +
          '<textarea name="text" placeholder="いまどうしてる？" rows="2"></textarea>' +
        '</div>' +
        '<div class="compose-meta">' +
          '<button type="button" class="spot-chip spot-chip--btn spot-chip--add" id="compose-spot-btn">' +
            icon('pin', { size: 12, className: 'icon--inline' }) +
            '<span data-spot-text>場所を追加</span>' +
          '</button>' +
          '<button type="button" class="spot-chip-clear" id="compose-spot-clear" hidden title="位置を外す">×</button>' +
          '<button type="button" class="compose-link-toggle" id="compose-link-toggle" aria-expanded="false">' +
            icon('github', { size: 12, fill: true, className: 'icon--inline' }) +
            '<span>+ リンクを追加</span>' +
          '</button>' +
        '</div>' +
        '<div class="compose-link" id="compose-link-row" hidden>' +
          '<label class="compose-link__label" for="compose-github-input">関連 URL (任意)</label>' +
          '<input name="github" id="compose-github-input" type="url" placeholder="https://github.com/owner/repo/blob/...">' +
        '</div>' +
        '<div class="compose-actions">' +
          '<div class="compose-tools">' +
            '<button type="button" class="compose-tool" title="image">' + icon('image', { size: 18 }) + '</button>' +
            '<button type="button" class="compose-tool" title="code">'  + icon('code',  { size: 18 }) + '</button>' +
            '<button type="button" class="compose-tool" data-spot-pick title="場所を選ぶ">' + icon('pin', { size: 18 }) + '</button>' +
            '<button type="button" class="compose-tool" title="poll">'  + icon('chart', { size: 18 }) + '</button>' +
          '</div>' +
          '<button type="submit" title="⌘/Ctrl + Enter">Push</button>' +
        '</div>' +
      '</form>' +
    '</div>'
  );
}
