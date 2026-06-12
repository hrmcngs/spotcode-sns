// Twitter-style composer. Disabled state when logged out.
import { icon } from './icons.js';

export function renderIdeaForm({ spot = 'somewhere', user = null } = {}) {
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
      '<form class="idea-form" data-spot="' + spot + '">' +
        '<textarea name="text" placeholder="What did you ship today?" rows="1" required></textarea>' +
        '<div class="compose-meta">' +
          '<span class="spot-chip">' + icon('pin', { size: 12, className: 'icon--inline' }) + spot + '</span>' +
          '<input name="github" placeholder="github.com/owner/repo/blob/...">' +
        '</div>' +
        '<div class="compose-actions">' +
          '<div class="compose-tools">' +
            '<button type="button" class="compose-tool" title="image">' + icon('image', { size: 18 }) + '</button>' +
            '<button type="button" class="compose-tool" title="code">'  + icon('code',  { size: 18 }) + '</button>' +
            '<button type="button" class="compose-tool" title="spot">'  + icon('pin',   { size: 18 }) + '</button>' +
            '<button type="button" class="compose-tool" title="poll">'  + icon('chart', { size: 18 }) + '</button>' +
          '</div>' +
          '<button type="submit" title="⌘/Ctrl + Enter">Push</button>' +
        '</div>' +
      '</form>' +
    '</div>'
  );
}
