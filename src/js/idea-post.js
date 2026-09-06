// Twitter-style composer. Disabled state when logged out. Spot is optional —
// the chip says "場所を追加" and only flips to a real spot once the user picks one.
//
// The body textarea has a visible bottom rule so users can clearly see where
// to type, and the optional GitHub URL field is collapsed behind a "+ Link"
// button to keep the main row from looking like a second text input.

import { icon } from './icons.js';
import { renderAvatar } from './avatar.js';
import { t } from './i18n.js';
import { isPostingAsOfficial } from './posting-identity.js';

export function renderIdeaForm({ user = null } = {}) {
  if (!user) {
    return (
      '<div class="composer composer--gated">' +
        '<div class="composer-gate">' +
          '<div class="composer-gate__title">' + t('composer.gate.title') + '</div>' +
          '<div class="composer-gate__actions">' +
            '<button class="btn btn--ghost" data-auth="login">' + t('nav.login') + '</button>' +
            '<button class="btn btn--primary" data-auth="register">' + t('composer.gate.signup') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  const asOfficial = isPostingAsOfficial();
  return (
    '<div class="composer' + (asOfficial ? ' composer--as-official' : '') + '">' +
      renderAvatar(user, { size: 'lg' }) +
      '<form class="idea-form">' +
        (asOfficial
          ? '<div class="composer-as-official-banner">' +
              icon('building', { size: 12, className: 'icon--inline' }) +
              ' <span>' + t('compose.as_official.banner').replace('{handle}', '@' + (user.handle || 'spotcode_official')) + '</span>' +
              '<button type="button" class="composer-as-official-banner__revert" data-account-revert-official="1">' +
                t('compose.as_official.revert') +
              '</button>' +
            '</div>'
          : '') +
        '<div class="composer-body">' +
          '<textarea name="text" placeholder="' + t('home.composer.placeholder') + '" rows="2"></textarea>' +
        '</div>' +
        '<div class="compose-meta">' +
          '<button type="button" class="spot-chip spot-chip--btn spot-chip--add" id="compose-spot-btn">' +
            icon('pin', { size: 12, className: 'icon--inline' }) +
            '<span data-spot-text>' + t('home.composer.add_spot') + '</span>' +
          '</button>' +
          '<button type="button" class="spot-chip-clear" id="compose-spot-clear" hidden title="' + t('composer.clear_spot') + '">×</button>' +
          '<button type="button" class="compose-link-toggle" id="compose-link-toggle" aria-expanded="false">' +
            icon('github', { size: 12, fill: true, className: 'icon--inline' }) +
            '<span>' + t('home.composer.add_url') + '</span>' +
          '</button>' +
          // Event link toggle — collapses the connpass URL input just
          // like the github link toggle. Distinct button so the two
          // categories don't fight for the same textbox.
          '<button type="button" class="compose-link-toggle" id="compose-event-toggle" aria-expanded="false">' +
            icon('calendar', { size: 12, className: 'icon--inline' }) +
            '<span>' + t('home.composer.add_event') + '</span>' +
          '</button>' +
          // Pick one optional post kind; pressing the active tag clears it.
          ['idea', 'bug'].map((kind) =>
            '<button type="button" class="compose-kind-toggle" data-compose-kind="' + kind + '" aria-pressed="false">' +
              icon(kind === 'bug' ? 'bug' : 'spark', { size: 12, className: 'icon--inline' }) +
              '<span class="compose-kind-toggle__label">' + t('kind.' + kind) + '</span>' +
            '</button>'
          ).join('') +
          // Show the native selection directly so its label cannot go stale.
          '<label class="compose-vis-select" title="' + t('compose.vis.label') + ' — ' + t('compose.vis.hint') + '">' +
            '<span class="compose-vis-select__icon" data-vis-icon>' +
              icon('globe', { size: 12, className: 'icon--inline' }) +
            '</span>' +
            '<select id="compose-vis-select" name="visibility" aria-label="' + t('compose.vis.label') + '">' +
              '<option value="public">' + t('compose.vis.public') + '</option>' +
              '<option value="mutuals">' + t('compose.vis.mutuals') + '</option>' +
              '<option value="following">' + t('compose.vis.following') + '</option>' +
              '<option value="friends">' + t('compose.vis.friends') + '</option>' +
              '<option value="org">' + t('compose.vis.org') + '</option>' +
              ((user.isOrg || user.github?.handle) ? '<option value="github_org">' + t('compose.vis.github_org') + '</option>' : '') +
              '<option value="only_me">' + t('compose.vis.only_me') + '</option>' +
            '</select>' +
          '</label>' +
        '</div>' +
        '<div class="compose-link" id="compose-link-row" hidden>' +
          '<label class="compose-link__label" for="compose-github-input">' + t('home.composer.url') + '</label>' +
          '<input name="github" id="compose-github-input" type="url" placeholder="https://github.com/owner/repo/blob/...">' +
          '<small>' + t('compose.org_attribution') + '</small>' +
        '</div>' +
        '<div class="compose-link" id="compose-event-row" hidden>' +
          '<label class="compose-link__label" for="compose-event-input">' + t('home.composer.event_url') + '</label>' +
          '<input name="event" id="compose-event-input" type="url" placeholder="https://connpass.com/event/000000/">' +
        '</div>' +
        // Photo attachments preview row. Populated by main.js when the
        // user picks files via the image tool; thumbnails carry an x
        // button to remove individual photos before posting.
        '<div class="compose-photos" id="compose-photos" hidden></div>' +
        // Hidden file input. `accept="image/*"` opens the photo picker.
        // `capture` is intentionally NOT set: iOS Safari crashes on the
        // `capture + multiple` combination for some WebKit versions,
        // and the iOS action sheet that opens without `capture` already
        // lets the user pick "Take Photo" or "Photo Library" — so we
        // don't lose camera access by dropping it.
        '<input type="file" id="compose-photo-input" accept="image/*" multiple hidden>' +
        '<div class="compose-actions">' +
          '<div class="compose-tools">' +
            '<button type="button" class="compose-tool" id="compose-photo-btn" title="写真を追加">' + icon('image', { size: 18 }) + '</button>' +
            '<button type="button" class="compose-tool" title="code">'  + icon('code',  { size: 18 }) + '</button>' +
            '<button type="button" class="compose-tool" data-spot-pick title="' + t('picker.title') + '">' + icon('pin', { size: 18 }) + '</button>' +
            '<button type="button" class="compose-tool" title="poll">'  + icon('chart', { size: 18 }) + '</button>' +
          '</div>' +
          '<div class="compose-submit">' +
            '<button type="button" class="btn btn--ghost compose-draft" data-compose-draft title="' + t('home.composer.draft_hint') + '">' + t('home.composer.draft') + '</button>' +
            '<button type="submit" title="⌘/Ctrl + Enter">' + t('home.composer.submit') + '</button>' +
          '</div>' +
        '</div>' +
        '<div class="compose-draft-banner" id="compose-draft-banner" hidden>' +
          '<span class="compose-draft-banner__text" data-draft-text>' + t('home.composer.draft_restored') + '</span>' +
          '<button type="button" class="compose-draft-banner__discard" data-compose-draft-discard>' + t('home.composer.draft_discard') + '</button>' +
        '</div>' +
      '</form>' +
    '</div>'
  );
}
