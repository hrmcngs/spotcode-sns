import { getApiKey, setApiKey, loadMaps } from '../gmap.js';
import { icon }                            from '../icons.js';

export function renderSettings() {
  const key = getApiKey();
  const masked = key ? key.slice(0, 6) + '…' + key.slice(-4) : '';
  return (
    '<div class="settings">' +
      '<h1 class="settings__title">Settings</h1>' +

      '<section class="settings-card">' +
        '<h2>Google Maps API key</h2>' +
        '<p class="settings__hint">' +
          'スポットの pin 選択に使います。' +
          '<a href="https://console.cloud.google.com/google/maps-apis/credentials" target="_blank" rel="noopener">Google Cloud Console</a>' +
          ' で Maps JavaScript API を有効化したキーを発行してください。キーは localStorage に保存され、リポジトリには絶対にコミットされません。' +
        '</p>' +
        '<form class="settings-form" id="gmaps-form">' +
          '<label>API key' +
            '<input name="key" type="password" autocomplete="off" spellcheck="false" placeholder="' + (masked || 'AIzaSy…') + '">' +
          '</label>' +
          '<div class="settings-form__actions">' +
            '<button type="submit" class="btn btn--primary">Save</button>' +
            (key ? '<button type="button" class="btn btn--ghost" id="gmaps-clear">Clear</button>' : '') +
            '<button type="button" class="btn btn--ghost" id="gmaps-test">Test</button>' +
          '</div>' +
          '<p class="settings-status" id="gmaps-status">' +
            (key ? '保存済み: ' + masked : 'まだ設定されていません') +
          '</p>' +
        '</form>' +
      '</section>' +

      '<section class="settings-card">' +
        '<h2>About</h2>' +
        '<p class="settings__hint">' +
          'spotcode-sns は、歩いた場所に紐づくアイデアを残すための SNS のプロトタイプです。' +
          'すべてのデータはこの端末のブラウザに保存されます。' +
        '</p>' +
      '</section>' +
    '</div>'
  );
}

// Wire form submission. Returns a teardown function.
export function bindSettings() {
  const form   = document.getElementById('gmaps-form');
  const status = document.getElementById('gmaps-status');
  if (!form || !status) return () => {};

  function showStatus(text, kind = '') {
    status.textContent = text;
    status.className = 'settings-status' + (kind ? ' is-' + kind : '');
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = new FormData(form).get('key');
    if (!v) { showStatus('空欄では保存できません', 'bad'); return; }
    setApiKey(v);
    form.querySelector('input[name="key"]').value = '';
    showStatus('保存しました。Test を押して動作確認できます。', 'ok');
  });

  document.getElementById('gmaps-clear')?.addEventListener('click', () => {
    if (!confirm('保存済みのキーを削除しますか？')) return;
    setApiKey('');
    showStatus('削除しました', '');
    setTimeout(() => location.reload(), 200);
  });

  document.getElementById('gmaps-test')?.addEventListener('click', async () => {
    showStatus('Google Maps を読み込み中…', '');
    try {
      await loadMaps();
      showStatus('OK — Google Maps API は正常に読み込めました', 'ok');
    } catch (err) {
      const msg = err.message === 'NO_KEY' ? 'キーが未設定です' : 'Maps の読み込みに失敗しました（キーが無効か、Maps JS API が有効化されていない可能性）';
      showStatus(msg, 'bad');
    }
  });
}
