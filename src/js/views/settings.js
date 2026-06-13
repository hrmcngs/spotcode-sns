import { loadMaps } from '../gmap.js';
import { getConfig, getOverride, setConfig, isConfigured, isUsingOverride, ping } from '../supa.js';
import { canBeDev, isDevMode, setDevMode } from '../dev-mode.js';
import { getLang, setLang, t } from '../i18n.js';

function attr(s) {
  return (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function maskHost(url) {
  try {
    const u = new URL(url);
    return u.host;
  } catch { return url; }
}

function userCards() {
  return (
    '<section class="settings-card">' +
      '<h2>Map</h2>' +
      '<p class="settings__hint">' +
        'スポットの pin 選択には ' +
        '<a href="https://www.openstreetmap.org/" target="_blank" rel="noopener">OpenStreetMap</a>' +
        ' のタイル、住所取得には ' +
        '<a href="https://nominatim.org/" target="_blank" rel="noopener">Nominatim</a>' +
        '、描画には ' +
        '<a href="https://leafletjs.com/" target="_blank" rel="noopener">Leaflet</a>' +
        ' を使っています。<strong>API キーや課金アカウントは不要</strong>、誰でもそのまま使えます。' +
      '</p>' +
      '<div class="settings-form__actions">' +
        '<button type="button" class="btn btn--ghost" id="map-test">地図ライブラリの動作確認</button>' +
      '</div>' +
      '<p class="settings-status" id="map-status">未確認</p>' +
    '</section>' +

    '<section class="settings-card">' +
      '<h2>About</h2>' +
      '<p class="settings__hint">' +
        'spotcode-sns は、歩いた場所に紐づくアイデアを残すための SNS のプロトタイプです。' +
        'アカウント・投稿は標準同梱の共有 DB に自動で保存されるので、何も設定しなくても他の端末からログインしたり他のユーザーの投稿を見たりできます。' +
      '</p>' +
    '</section>'
  );
}

function devCards({ cfg, override, usingOverride }) {
  return (
    '<h2 class="settings__section">Developer settings</h2>' +
    '<p class="settings__section-hint">この区画はホワイトリストに載っているアカウントだけに表示されます。一般ユーザーには Supabase の上書きや内部 DB の情報は出ません。</p>' +

    '<section class="settings-card">' +
      '<h2>Developer mode <span class="settings-tag">' + (isDevMode() ? 'ON' : 'OFF') + '</span></h2>' +
      '<p class="settings__hint">' +
        '通報キューや内部 ID などの開発者向け UI を表示するかどうかのトグル。topbar に黄色い「dev」チップが立つかどうかで現在の状態が分かる。' +
      '</p>' +
      '<div class="settings-form__actions">' +
        '<button type="button" class="btn btn--' + (isDevMode() ? 'ghost' : 'primary') + '" id="dev-mode-toggle">' +
          (isDevMode() ? 'OFF にする' : 'ON にする') +
        '</button>' +
      '</div>' +
    '</section>' +

    '<section class="settings-card">' +
      '<h2>Supabase (cross-device sync)' +
        (isConfigured() ? ' <span class="settings-tag is-ok">connected</span>'
                        : ' <span class="settings-tag">未設定</span>') + '</h2>' +
      '<p class="settings__hint">' +
        (usingOverride
          ? '現在は <strong>あなたが /settings で設定した独自プロジェクト</strong>に接続しています。'
          : '現在は <strong>spotcode-sns に標準同梱の共有プロジェクト</strong>に接続しています。' +
            'アカウント・投稿・いいね等が他のユーザーと同じ DB に保存されるので、' +
            '別端末からのログインや他のユーザーの検索が動きます。何も設定する必要はありません。') +
      '</p>' +
      '<dl class="settings-kv">' +
        '<dt>Project URL</dt><dd><code>' + attr(maskHost(cfg.url)) + '</code></dd>' +
        '<dt>Mode</dt><dd>' +
          (usingOverride
            ? '<span class="settings-tag">自分の Supabase で上書き中</span>'
            : '<span class="settings-tag is-ok">共有プロジェクト (default)</span>') +
        '</dd>' +
      '</dl>' +
      '<div class="settings-form__actions">' +
        '<button type="button" class="btn btn--ghost btn--sm" id="supa-test">接続テスト</button>' +
        '<button type="button" class="btn btn--ghost btn--sm" id="supa-toggle-override">' +
          (usingOverride ? '上書きをやめて共有 DB に戻す' : '自分の Supabase に上書きする') +
        '</button>' +
      '</div>' +
      '<p class="settings-status" id="supa-status">未確認</p>' +

      '<form class="settings-form" id="supa-form" hidden>' +
        '<p class="settings__hint">自分の Supabase プロジェクトに切り替えるには、' +
          '<a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a>' +
          ' で Free プロジェクトを作って Project Settings → API から URL と Publishable key をコピーして貼ってください。' +
        '</p>' +
        '<label>Project URL' +
          '<input name="url" type="url" autocomplete="off" spellcheck="false" ' +
            'placeholder="https://xxxx.supabase.co" value="' + attr(override.url) + '">' +
        '</label>' +
        '<label>anon / publishable key' +
          '<input name="anonKey" type="password" autocomplete="off" spellcheck="false" ' +
            'placeholder="sb_publishable_…">' +
        '</label>' +
        '<div class="settings-form__actions">' +
          '<button type="submit" class="btn btn--primary">保存して上書き</button>' +
          (usingOverride
            ? '<button type="button" class="btn btn--ghost" id="supa-clear">上書きを削除</button>'
            : '') +
        '</div>' +
      '</form>' +

      '<p class="settings__note">' +
        '⚠️ <strong>secret / service_role</strong> キーは絶対に貼らないでください。このアプリは静的サイトなので、貼った瞬間に丸見えになり DB を破壊される可能性があります。' +
        '貼っていいのは <code>sb_publishable_…</code> または旧形式の <code>anon public</code> JWT のみです。' +
      '</p>' +
    '</section>'
  );
}

export function renderSettings() {
  const cfg = getConfig();
  const override = getOverride();
  const usingOverride = isUsingOverride();

  const lang = getLang();
  return (
    '<div class="settings">' +
      '<h1 class="settings__title">' + t('settings.title') + '</h1>' +

      '<section class="settings-card">' +
        '<h2>' + t('settings.lang.title') + '</h2>' +
        '<p class="settings__hint">' + t('settings.lang.hint') + '</p>' +
        '<div class="settings-form__actions">' +
          '<button type="button" class="btn btn--' + (lang === 'ja' ? 'primary' : 'ghost') + '" data-lang="ja">' + t('settings.lang.ja') + '</button>' +
          '<button type="button" class="btn btn--' + (lang === 'en' ? 'primary' : 'ghost') + '" data-lang="en">' + t('settings.lang.en') + '</button>' +
        '</div>' +
      '</section>' +

      userCards() +
      (canBeDev() ? devCards({ cfg, override, usingOverride }) : '') +
    '</div>'
  );
}

export function bindSettings() {
  // Map test
  const mapStatus = document.getElementById('map-status');
  const mapBtn    = document.getElementById('map-test');
  if (mapBtn && mapStatus) {
    const show = (t, k = '') => {
      mapStatus.textContent = t;
      mapStatus.className = 'settings-status' + (k ? ' is-' + k : '');
    };
    mapBtn.addEventListener('click', async () => {
      show('Leaflet を読み込み中…');
      try {
        await loadMaps();
        show('OK — Leaflet と OpenStreetMap が読み込めました', 'ok');
      } catch (err) { show('読み込みに失敗しました: ' + err.message, 'bad'); }
    });
  }

  // Supabase
  const supaForm   = document.getElementById('supa-form');
  const supaStatus = document.getElementById('supa-status');
  const show = (t, k = '') => {
    if (!supaStatus) return;
    supaStatus.textContent = t;
    supaStatus.className = 'settings-status' + (k ? ' is-' + k : '');
  };

  document.getElementById('supa-toggle-override')?.addEventListener('click', () => {
    if (supaForm) supaForm.hidden = !supaForm.hidden;
  });

  supaForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(supaForm);
    const url = String(fd.get('url') || '').trim();
    const anonKey = String(fd.get('anonKey') || '').trim();
    if (!url || !anonKey) { show('Project URL と key の両方を入れてください', 'bad'); return; }
    if (!/^https:\/\/.+\.supabase\.(co|in)/i.test(url)) {
      show('URL は https://xxxx.supabase.co 形式で入力してください', 'bad');
      return;
    }
    setConfig({ url, anonKey });
    show('上書き保存しました。リロードして反映します…', 'ok');
    setTimeout(() => location.reload(), 400);
  });

  document.getElementById('supa-clear')?.addEventListener('click', () => {
    if (!confirm('上書きを削除して共有プロジェクトに戻しますか？')) return;
    setConfig({ url: '', anonKey: '' });
    show('上書きを削除しました。リロードします…', 'ok');
    setTimeout(() => location.reload(), 400);
  });

  // Language switch — setLang() persists + triggers a hard reload so
  // every cached HTML fragment / modal template re-renders in the new
  // language without us having to track listeners.
  document.querySelectorAll('[data-lang]').forEach(btn => {
    btn.addEventListener('click', () => setLang(btn.getAttribute('data-lang')));
  });

  // Developer-mode toggle (only present when the current user is on the
  // allowlist — the button doesn't render otherwise).
  document.getElementById('dev-mode-toggle')?.addEventListener('click', () => {
    setDevMode(!isDevMode());
    location.reload();
  });

  document.getElementById('supa-test')?.addEventListener('click', async () => {
    show('Supabase に接続中…', '');
    try {
      await ping();
      show('OK — Supabase に接続できました', 'ok');
    } catch (err) {
      const msg = err.message === 'NO_CONFIG' ? 'URL / anon key を保存してください'
                : err.message === 'AUTH_FAILED' ? 'anon key が無効です'
                : '接続に失敗しました: ' + err.message;
      show(msg, 'bad');
    }
  });
}
