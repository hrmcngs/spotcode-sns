// Placeholder view for nav items that aren't fully built out yet.
// Routes use this so clicks visibly change the page instead of feeling broken.
import { icon } from '../icons.js';

const PRESETS = {
  explore:        { title: 'Explore',       sub: '近所で投稿されたアイデアやコードを発見する場所。',     ico: 'compass' },
  spots:          { title: 'Spots',         sub: 'スポットごとに、過去にそこで生まれたアイデアを束ねる。',  ico: 'pin' },
  repos:          { title: 'Repos',         sub: 'GitHub と紐づくリポジトリ単位で動きを見る。',         ico: 'repo' },
  notifications:  { title: 'Notifications', sub: 'リプライ・スター・フォークを通知。',                  ico: 'bell' },
};

export function renderStub(key) {
  const p = PRESETS[key] || { title: key, sub: '', ico: 'spark' };
  return (
    '<div class="stub">' +
      '<div class="stub__icon">' + icon(p.ico, { size: 32 }) + '</div>' +
      '<h2 class="stub__title">' + p.title + '</h2>' +
      '<p class="stub__sub">' + p.sub + '</p>' +
      '<p class="stub__tag">Coming soon</p>' +
      '<a class="back-home" href="/">← Back to home</a>' +
    '</div>'
  );
}
