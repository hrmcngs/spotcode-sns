import { t } from '../i18n.js';
import { renderIdeaForm } from '../idea-post.js';
import { currentUser } from '../auth.js';
import { displayUser } from '../posting-identity.js';

export function timelineToolbar() {
  return '<header class="timeline-toolbar">' +
    '<h1>' + t('みんなの活動') + '</h1>' +
    '</header>' +
    '<div class="modal native-compose-modal" hidden>' +
      '<div class="modal__backdrop" data-close-compose></div>' +
      '<section class="modal__card" role="dialog" aria-modal="true" aria-labelledby="compose-dialog-title" tabindex="-1">' +
        '<header class="compose-dialog-head"><button type="button" data-close-compose>' + t('Cancel') + '</button>' +
          '<h2 id="compose-dialog-title">' + t('New idea') + '</h2><span aria-hidden="true"></span></header>' +
        renderIdeaForm({ user: displayUser(currentUser()) }) +
      '</section></div>';
}
