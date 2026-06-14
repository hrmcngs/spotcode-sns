// Quick-nav button row, used by the Not-found / profile-not-found
// stubs so users don't dead-end on those pages. On mobile the
// sidebar is hidden behind the hamburger which isn't obvious, so
// an explicit row of "go to X" buttons inline in the stub matters.

import { url } from './router.js';
import { currentUser } from './auth.js';
import { icon } from './icons.js';

export function quickNavLinks() {
  const me = currentUser();
  const items = [
    { href: '/',              ico: 'home',     label: 'Home' },
    { href: '/spots',         ico: 'pin',      label: 'Spots' },
    { href: '/notifications', ico: 'bell',     label: 'Notifications', signedInOnly: true },
    { href: me ? '/' + me.handle : null, ico: 'user', label: 'Profile', signedInOnly: true },
    { href: '/settings',      ico: 'gear',     label: 'Settings' },
  ];
  return (
    '<div class="quick-nav">' +
      items
        .filter(it => !it.signedInOnly || me)
        .filter(it => it.href)
        .map(it =>
          '<a class="quick-nav__item" href="' + url(it.href) + '">' +
            '<span class="quick-nav__ico">' + icon(it.ico, { size: 18 }) + '</span>' +
            '<span class="quick-nav__label">' + it.label + '</span>' +
          '</a>'
        ).join('') +
    '</div>'
  );
}
