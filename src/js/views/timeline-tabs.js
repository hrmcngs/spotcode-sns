// Shared `For you / Following / Spots` tab bar used by both the home
// timeline (/, /following) and the map view (/spots). Extracted so
// the active state stays consistent — render the same HTML from one
// place and pass the active key.

import { url } from '../router.js';
import { t }   from '../i18n.js';

// active ∈ 'foryou' | 'following' | 'spots'
export function timelineTabs(active) {
  const cls = (k) => 'tab' + (active === k ? ' is-active' : '');
  return (
    '<div class="timeline__head">' +
      '<a class="' + cls('foryou')    + '" href="' + url('/')          + '">' + t('home.tab.foryou')    + '</a>' +
      '<a class="' + cls('following') + '" href="' + url('/following') + '">' + t('home.tab.following') + '</a>' +
      '<a class="' + cls('spots')     + '" href="' + url('/spots')     + '">' + t('home.tab.spots')     + '</a>' +
    '</div>'
  );
}
