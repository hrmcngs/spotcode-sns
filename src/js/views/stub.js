// Placeholder view for nav items that aren't fully built out yet.
// Routes use this so clicks visibly change the page instead of feeling broken.
import { icon } from '../icons.js';
import { t }    from '../i18n.js';

const PRESETS = {
  explore:       { title: 'Explore',       ico: 'compass' },
  spots:         { title: 'Spots',         ico: 'pin' },
  repos:         { title: 'Repos',         ico: 'repo' },
  notifications: { title: 'Notifications', ico: 'bell' },
};

export function renderStub(key) {
  const p = PRESETS[key] || { title: key, ico: 'spark' };
  const sub = t('stub.sub.' + key);
  return (
    '<div class="stub">' +
      '<div class="stub__icon">' + icon(p.ico, { size: 32 }) + '</div>' +
      '<h2 class="stub__title">' + p.title + '</h2>' +
      '<p class="stub__sub">' + sub + '</p>' +
      '<p class="stub__tag">' + t('common.coming_soon') + '</p>' +
      '<a class="back-home" href="/">' + t('profile.back') + '</a>' +
    '</div>'
  );
}
