import { loadMaps } from '../gmap.js';
import { getConfig, setConfig, isConfigured, ping } from '../supa.js';

function attr(s) {
  return (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

export function renderSettings() {
  const cfg = getConfig();
  const maskedKey = cfg.anonKey
    ? cfg.anonKey.slice(0, 6) + '…' + cfg.anonKey.slice(-4)
    : '';

  return (
    '<div class="settings">' +
      '<h1 class="settings__title">Settings</h1>' +

      '<section class="settings-card">' +
        '<h2>Supabase (cross-device sync)' +
          (isConfigured() ? ' <span class="settings-tag is-ok">connected</span>'
                          : ' <span class="settings-tag">未設定</span>') + '</h2>' +
        '<p class="settings__hint">' +
          '別端末からアカウントを引き継いだり、他のユーザを検索したりするには ' +
          '<a href="https://supabase.com" target="_blank" rel="noopener">Supabase</a>' +
          ' のプロジェクトが必要です。<strong>無料枠で十分</strong>、課金カードも不要。' +
        '</p>' +
        '<ol class="settings__steps">' +
          '<li><a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a> でサインアップ (GitHub アカウントで OK)</li>' +
          '<li>「New project」 → 名前を入れて Region は <code>Northeast Asia (Tokyo)</code> 推奨</li>' +
          '<li>プロジェクトが起動したら左メニュー <strong>Project Settings → API</strong></li>' +
          '<li>「Project URL」と「Project API keys → anon public」を下にコピー</li>' +
        '</ol>' +
        '<form class="settings-form" id="supa-form">' +
          '<label>Project URL' +
            '<input name="url" type="url" autocomplete="off" spellcheck="false" ' +
              'placeholder="https://xxxx.supabase.co" value="' + attr(cfg.url) + '">' +
          '</label>' +
          '<label>anon public key' +
            '<input name="anonKey" type="password" autocomplete="off" spellcheck="false" ' +
              'placeholder="' + (maskedKey || 'eyJhbGciOi…') + '">' +
          '</label>' +
          '<div class="settings-form__actions">' +
            '<button type="submit" class="btn btn--primary">Save</button>' +
            (isConfigured() ? '<button type="button" class="btn btn--ghost" id="supa-clear">Clear</button>' : '') +
            '<button type="button" class="btn btn--ghost" id="supa-test">接続テスト</button>' +
          '</div>' +
          '<p class="settings-status" id="supa-status">' +
            (isConfigured() ? '保存済み: ' + attr(cfg.url) : 'まだ設定されていません') +
          '</p>' +
        '</form>' +
        '<p class="settings__note">' +
          '※ ここに貼るのは <strong>anon public key</strong> です。' +
          '<code>service_role</code> キーは絶対に貼らないでください — このアプリは静的サイトなので、貼った瞬間に丸見えになります。' +
        '</p>' +
      '</section>' +

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
          'Supabase 未設定時は全データがこの端末のブラウザに、設定済みなら Supabase 側に保存されます。' +
        '</p>' +
      '</section>' +
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

  // Supabase config
  const supaForm = document.getElementById('supa-form');
  if (supaForm) {
    const supaStatus = document.getElementById('supa-status');
    const show = (t, k = '') => {
      supaStatus.textContent = t;
      supaStatus.className = 'settings-status' + (k ? ' is-' + k : '');
    };
    supaForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(supaForm);
      const url = String(fd.get('url') || '').trim();
      const anonKey = String(fd.get('anonKey') || '').trim();
      if (!url || !anonKey) { show('Project URL と anon key の両方を入れてください', 'bad'); return; }
      if (!/^https:\/\/.+\.supabase\.(co|in)/i.test(url)) {
        show('URL は https://xxxx.supabase.co 形式で入力してください', 'bad');
        return;
      }
      setConfig({ url, anonKey });
      supaForm.querySelector('input[name="anonKey"]').value = '';
      show('保存しました。「接続テスト」で動作確認してください。', 'ok');
    });
    document.getElementById('supa-clear')?.addEventListener('click', () => {
      if (!confirm('保存済みの Supabase 設定を削除しますか？')) return;
      setConfig({ url: '', anonKey: '' });
      show('削除しました', '');
      setTimeout(() => location.reload(), 200);
    });
    document.getElementById('supa-test')?.addEventListener('click', async () => {
      show('Supabase に接続中…', '');
      try {
        await ping();
        show('OK — Supabase に接続できました。次のステップで auth を移行します。', 'ok');
      } catch (err) {
        const msg = err.message === 'NO_CONFIG' ? 'URL / anon key を保存してください'
                  : err.message === 'AUTH_FAILED' ? 'anon key が無効です'
                  : '接続に失敗しました: ' + err.message;
        show(msg, 'bad');
      }
    });
  }
}
