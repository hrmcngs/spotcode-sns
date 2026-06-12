// Twitter-style composer. Disabled state when logged out. Spot is optional —
// the chip says "場所を追加" and only flips to a real spot once the user picks one.
import { icon } from './icons.js';

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

  const av = user.avatar || (user.name?.[0] || '?').toUpperCase();
  return (
    '<div class="composer">' +
      '<div class="avatar avatar--lg">' + av + '</div>' +
      '<form class="idea-form">' +
        '<textarea name="text" placeholder="いまどうしてる？" rows="1" required></textarea>' +
        '<div class="compose-meta">' +
          '<button type="button" class="spot-chip spot-chip--btn spot-chip--add" id="compose-spot-btn">' +
            icon('pin', { size: 12, className: 'icon--inline' }) +
            '<span data-spot-text>場所を追加</span>' +
          '</button>' +
          '<button type="button" class="spot-chip-clear" id="compose-spot-clear" hidden title="位置を外す">×</button>' +
          '<input name="github" placeholder="github.com/owner/repo/blob/... (任意)">' +
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
