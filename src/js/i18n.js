// Lightweight i18n. Two languages baked in (ja, en). State lives in
// localStorage and is read synchronously by t() so render paths stay
// branch-free. setLang() triggers a full reload — most strings are
// captured at render time and a reload is the cheapest way to refresh
// every modal / cached HTML fragment.

import { KEYS, read, write } from './storage.js';

const SUPPORTED = ['ja', 'en'];
const DEFAULT_LANG = 'ja';

const DICT = {
  ja: {
    // ---------------- nav / topbar ----------------
    'nav.search.placeholder':  'スポット・アイデア・リポジトリを検索…',
    'nav.home':                'Home',
    'nav.explore':             'Explore',
    'nav.notifications':       'Notifications',
    'nav.profile':             'Profile',
    'nav.settings':            'Settings',
    'nav.compose':             'New idea',
    'nav.login':               'Log in',
    'nav.logout':              'Log out',

    // ---------------- home / timeline ----------------
    'home.tab.foryou':         'For you',
    'home.tab.following':      'Following',
    'home.tab.spots':          'Spots',
    'home.composer.placeholder': 'いまどうしてる?',
    'home.composer.url':       '関連 URL (任意)',
    'home.composer.add_url':   '+ リンクを追加',
    'home.composer.add_spot':  '場所を追加',
    'home.composer.submit':    'Push',
    'home.composer.draft':     '下書き保存',
    'home.composer.draft_hint':'端末に保存 (オフライン可)',
    'home.composer.draft_saved': '下書きを保存しました',
    'home.composer.draft_restored': '下書きを復元しました',
    'home.composer.draft_discard': '破棄',
    'home.composer.error_empty': '本文を入力してください',
    'composer.gate.title':     'アイデアを投稿するにはサインインしてください',
    'composer.gate.signup':    'Sign up',
    'composer.clear_spot':     '位置を外す',
    'home.empty.title':        'タイムラインはまだ空です',
    'home.empty.signed_in':    '上のコンポーザーから最初のアイデアを投稿してみましょう。',
    'home.empty.guest':        'サインインして最初の一歩を投稿してみましょう。',
    'home.loading':            'タイムラインを読み込み中…',
    'home.error.title':        '読み込みに失敗しました',
    'home.error.reload':       'リロード',

    // ---------------- profile ----------------
    'profile.tab.posts':       'Posts',
    'profile.tab.spots':       'Spots',
    'profile.tab.likes':       'Likes',
    'profile.btn.follow':      'Follow',
    'profile.btn.following':   'Following',
    'profile.btn.edit':        'Edit profile',
    'profile.btn.more':        'More',
    'profile.stat.following':  'Following',
    'profile.stat.followers':  'Followers',
    'profile.stat.posts':      'Posts',
    'profile.loading':         'プロフィールを読み込み中…',
    'profile.empty.posts':     'まだ投稿がありません。',
    'profile.empty.spots':     'まだ場所付きの投稿はありません。',
    'profile.empty.likes':     'まだいいねした投稿はありません。',
    'profile.not_found.title': 'は登録されていません',
    'profile.not_found.sub':   'このアカウントは存在しないか、まだ何も投稿していません。',
    'profile.back':            '← Back to home',
    'profile.joined':          'Joined ',

    // ---------------- follow list ----------------
    'follow.empty.followers':  'まだフォロワーはいません。',
    'follow.empty.following':  'まだ誰もフォローしていません。',
    'follow.loading':          '読み込み中…',

    // ---------------- spot view ----------------
    'spot.subtitle':           'この市区町村で生まれたアイデア',
    'spot.empty':              'まだここからの投稿はありません。',
    'spot.loading':            '投稿を読み込み中…',

    // ---------------- spot picker ----------------
    'picker.title':            '場所を選ぶ',
    'picker.use_geo':          '現在地を使う',
    'picker.label_placeholder':'ラベル（任意・建物名や店名）',
    'picker.address':          '住所',
    'picker.address_placeholder':'地図をクリックして取得…',
    'picker.confirm':          'Confirm',
    'picker.cancel':           'Cancel',
    'picker.geo.no_browser':   'このブラウザは Geolocation に対応していません',
    'picker.geo.denied':       '位置情報の利用が許可されていません。ブラウザの設定を確認してください。',
    'picker.reset_auto':       '自動取得に戻す',
    'picker.hint.house':       '番地: {n}（自動取得）',
    'picker.hint.no_house':    '⚠ 番地は自動取得できませんでした — 上の住所欄に「6-17-2」など追記してください',
    'picker.hint.no_address':  '住所が見つかりません — 上の住所欄に直接入力してください',

    // ---------------- post kind tag ----------------
    'kind.idea':               'アイデア',
    'kind.idea.title':         'アイデアタグ',

    // ---------------- notifications ----------------
    'notif.page.title':        '通知',
    'notif.loading':           '読み込み中…',
    'notif.signin.title':      'サインインしてください',
    'notif.signin.sub':        '通知はサインインしたユーザー宛のものを表示します。',
    'notif.error.title':       '読み込み失敗',
    'notif.empty.title':       'まだ通知はありません',
    'notif.empty.sub':         'いいね・コメント・メンション・フォロー・フォロリクがあるとここに集まります。',
    'notif.accept':            '承認',
    'notif.deny':              '拒否',
    'notif.label.like':        'いいねしました',
    'notif.label.comment':     'コメントしました',
    'notif.label.mention':     'メンションされました',
    'notif.label.follow':      'フォローされました',
    'notif.label.follow_request': 'フォローリクエストされました',

    // ---------------- settings ----------------
    'settings.title':          'Settings',
    'settings.lang.title':     'Language / 言語',
    'settings.lang.hint':      'UI の言語を選びます。投稿の本文は元のまま表示されます。',
    'settings.lang.ja':        '日本語',
    'settings.lang.en':        'English',
    'settings.map.title':      'Map',
    'settings.map.test':       '地図ライブラリの動作確認',
    'settings.about.title':    'About',
    'settings.about.body':     'spotcode-sns は、歩いた場所に紐づくアイデアを残すための SNS のプロトタイプです。アカウント・投稿は標準同梱の共有 DB に自動で保存されるので、何も設定しなくても他の端末からログインしたり他のユーザーの投稿を見たりできます。',
    'settings.dev.section':    'Developer settings',
    'settings.dev.section_hint':'この区画はホワイトリストに載っているアカウントだけに表示されます。',
    'settings.dev.title':      'Developer mode',
    'settings.dev.on':         'OFF にする',
    'settings.dev.off':        'ON にする',

    // ---------------- common ----------------
    'common.cancel':           'Cancel',
    'common.save':             'Save',
    'common.delete':           '削除',
    'common.unfollow':         'Following',
    'common.idea':             'idea',
    'common.ideas':            'ideas',
    'common.not_found':        'Not found',
    'common.coming_soon':      'Coming soon',

    // ---------------- right rail ----------------
    'rail.activity':           'Your activity <span class="dim">last 12 months</span>',
    'rail.trending':           'Trending spots <span class="dim">市区町村別</span>',
    'rail.who_to_follow':      'Who to follow',

    'stub.sub.explore':        '近所で投稿されたアイデアやコードを発見する場所。',
    'stub.sub.spots':          'スポットごとに、過去にそこで生まれたアイデアを束ねる。',
    'stub.sub.repos':          'GitHub と紐づくリポジトリ単位で動きを見る。',
    'stub.sub.notifications':  'リプライ・スター・フォークを通知。',

    // ---------------- geo gate ----------------
    'geo.waiting':             '📍 位置情報を取得しています…（許可を求められたら「許可」を押してください）',
    'geo.denied':              '📍 位置情報がオフです。場所付きの投稿は、現地から近づくと見えるようになります。',
    'geo.showing_nearby':      '📍 半径 {r} m 以内のスポット投稿のみ表示中',
    'geo.too_far':             '📍 ここから {r} m 以内にいる人だけ閲覧できます。',

    // ---------------- map view ----------------
    'map.title':               '📍 マップ',
    'map.loading':             'マップを読み込み中…',
    'map.error':               'マップの読み込みに失敗しました',
    'map.subtitle_with_loc':   '{n} 件のピン · 半径 {r} m 以内のピンを開くと中身が見えます',
    'map.subtitle_denied':     '{n} 件のピン · 位置情報がオフのため中身は非表示（場所と建物名だけ見えます）',
    'map.subtitle_no_loc':     '{n} 件のピン · 位置情報を許可すると近くの中身が読めます',
    'map.unknown_building':    '（建物名なし）',
    'map.locked':              '📍 ここから半径 {r} m 以内に来ると中身が読めます',
  },

  en: {
    'nav.search.placeholder':  'Search spots, ideas, repos…',
    'nav.home':                'Home',
    'nav.explore':             'Explore',
    'nav.notifications':       'Notifications',
    'nav.profile':             'Profile',
    'nav.settings':            'Settings',
    'nav.compose':             'New idea',
    'nav.login':               'Log in',
    'nav.logout':              'Log out',

    'home.tab.foryou':         'For you',
    'home.tab.following':      'Following',
    'home.tab.spots':          'Spots',
    'home.composer.placeholder': "What's happening?",
    'home.composer.url':       'Related URL (optional)',
    'home.composer.add_url':   '+ Add link',
    'home.composer.add_spot':  'Add location',
    'home.composer.submit':    'Push',
    'home.composer.draft':     'Save draft',
    'home.composer.draft_hint':'Saved on this device (works offline)',
    'home.composer.draft_saved': 'Draft saved',
    'home.composer.draft_restored': 'Draft restored',
    'home.composer.draft_discard': 'Discard',
    'home.composer.error_empty': 'Write something first',
    'composer.gate.title':     'Sign in to post your ideas',
    'composer.gate.signup':    'Sign up',
    'composer.clear_spot':     'Remove location',
    'home.empty.title':        'Your timeline is empty',
    'home.empty.signed_in':    'Use the composer above to post your first idea.',
    'home.empty.guest':        'Sign in to post your first idea.',
    'home.loading':            'Loading timeline…',
    'home.error.title':        'Failed to load',
    'home.error.reload':       'Reload',

    'profile.tab.posts':       'Posts',
    'profile.tab.spots':       'Spots',
    'profile.tab.likes':       'Likes',
    'profile.btn.follow':      'Follow',
    'profile.btn.following':   'Following',
    'profile.btn.edit':        'Edit profile',
    'profile.btn.more':        'More',
    'profile.stat.following':  'Following',
    'profile.stat.followers':  'Followers',
    'profile.stat.posts':      'Posts',
    'profile.loading':         'Loading profile…',
    'profile.empty.posts':     'No posts yet.',
    'profile.empty.spots':     'No posts with a location yet.',
    'profile.empty.likes':     'No liked posts yet.',
    'profile.not_found.title': "doesn't exist",
    'profile.not_found.sub':   "This account doesn't exist, or hasn't posted anything.",
    'profile.back':            '← Back to home',
    'profile.joined':          'Joined ',

    'follow.empty.followers':  'No followers yet.',
    'follow.empty.following':  'Not following anyone yet.',
    'follow.loading':          'Loading…',

    'spot.subtitle':           'Ideas from this area',
    'spot.empty':              'No posts from here yet.',
    'spot.loading':            'Loading posts…',

    'picker.title':            'Pick a location',
    'picker.use_geo':          'Use current location',
    'picker.label_placeholder':'Label (optional — building or shop name)',
    'picker.address':          'Address',
    'picker.address_placeholder':'Click the map to fill…',
    'picker.confirm':          'Confirm',
    'picker.cancel':           'Cancel',
    'picker.geo.no_browser':   'This browser does not support Geolocation',
    'picker.geo.denied':       'Location access denied. Check your browser settings.',
    'picker.reset_auto':       'Reset to auto-detected',
    'picker.hint.house':       'House number: {n} (auto-detected)',
    'picker.hint.no_house':    '⚠ House number could not be auto-detected — add it (e.g. "6-17-2") in the address field above.',
    'picker.hint.no_address':  'No address found — type one directly in the address field above.',

    // ---------------- post kind tag ----------------
    'kind.idea':               'idea',
    'kind.idea.title':         'Idea tag',

    // ---------------- notifications ----------------
    'notif.page.title':        'Notifications',
    'notif.loading':           'Loading…',
    'notif.signin.title':      'Sign in to see notifications',
    'notif.signin.sub':        'Notifications shown here are addressed to the signed-in user.',
    'notif.error.title':       'Failed to load',
    'notif.empty.title':       'No notifications yet',
    'notif.empty.sub':         'Likes, comments, mentions, follows and follow requests land here.',
    'notif.accept':            'Accept',
    'notif.deny':              'Deny',
    'notif.label.like':        'liked your post',
    'notif.label.comment':     'commented',
    'notif.label.mention':     'mentioned you',
    'notif.label.follow':      'followed you',
    'notif.label.follow_request': 'requested to follow you',

    'settings.title':          'Settings',
    'settings.lang.title':     'Language',
    'settings.lang.hint':      'Choose the UI language. Post content stays in its original language.',
    'settings.lang.ja':        '日本語',
    'settings.lang.en':        'English',
    'settings.map.title':      'Map',
    'settings.map.test':       'Test the map library',
    'settings.about.title':    'About',
    'settings.about.body':     'spotcode-sns is a prototype SNS for capturing ideas tied to the places where they happened. Accounts and posts are auto-saved to the bundled shared DB, so you can sign in from another device and find other users without configuring anything.',
    'settings.dev.section':    'Developer settings',
    'settings.dev.section_hint':'This section only shows up for allowlisted accounts.',
    'settings.dev.title':      'Developer mode',
    'settings.dev.on':         'Turn OFF',
    'settings.dev.off':        'Turn ON',

    'common.cancel':           'Cancel',
    'common.save':             'Save',
    'common.delete':           'Delete',
    'common.unfollow':         'Following',
    'common.idea':             'idea',
    'common.ideas':            'ideas',
    'common.not_found':        'Not found',
    'common.coming_soon':      'Coming soon',

    'rail.activity':           'Your activity <span class="dim">last 12 months</span>',
    'rail.trending':           'Trending spots <span class="dim">by city / ward</span>',
    'rail.who_to_follow':      'Who to follow',

    'stub.sub.explore':        'Find ideas and code posted in your area.',
    'stub.sub.spots':          'Browse ideas grouped by the place they were born.',
    'stub.sub.repos':          'Activity per GitHub repository.',
    'stub.sub.notifications':  'Replies, stars, and forks land here.',

    'geo.waiting':             '📍 Getting your location… (allow access when asked)',
    'geo.denied':              "📍 Location is off. Spot-tagged posts become visible once you're near them.",
    'geo.showing_nearby':      '📍 Showing spot posts within {r} m of you',
    'geo.too_far':             '📍 Only people within {r} m of here can read this.',

    'map.title':               '📍 Map',
    'map.loading':             'Loading map…',
    'map.error':               'Failed to load the map',
    'map.subtitle_with_loc':   '{n} pins · open a pin within {r} m to read the idea',
    'map.subtitle_denied':     '{n} pins · location is off, so only the spot and building name are visible',
    'map.subtitle_no_loc':     '{n} pins · allow location access to read nearby ideas',
    'map.unknown_building':    '(unnamed building)',
    'map.locked':              '📍 Come within {r} m to read this idea',
  },
};

let active = (() => {
  try {
    const stored = read(KEYS.lang, null);
    if (stored && SUPPORTED.includes(stored)) return stored;
  } catch {}
  return DEFAULT_LANG;
})();

export function getLang() { return active; }

export function setLang(lang) {
  if (!SUPPORTED.includes(lang)) return false;
  active = lang;
  try { write(KEYS.lang, lang); } catch {}
  document.documentElement.setAttribute('lang', lang);
  // Most strings are baked into HTML at render time — a hard reload is
  // the simplest way to refresh every visible string + modal template.
  location.reload();
  return true;
}

// Look up a key. Falls back to the JA dictionary, then to the literal
// key so missing translations are visible during development. An
// optional second arg interpolates `{name}` placeholders in the
// matched string.
export function t(key, params) {
  const table = DICT[active] || DICT[DEFAULT_LANG];
  const raw = (table && table[key]) || (DICT.ja && DICT.ja[key]) || key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name) =>
    params[name] != null ? String(params[name]) : '{' + name + '}'
  );
}

// Apply the current language to <html lang> on boot.
export function initI18n() {
  document.documentElement.setAttribute('lang', active);
}
