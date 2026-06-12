import { loadMaps } from '../gmap.js';

export function renderSettings() {
  return (
    '<div class="settings">' +
      '<h1 class="settings__title">Settings</h1>' +

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
          'すべてのデータはこの端末のブラウザに保存されます。' +
        '</p>' +
      '</section>' +
    '</div>'
  );
}

export function bindSettings() {
  const status = document.getElementById('map-status');
  const btn    = document.getElementById('map-test');
  if (!btn || !status) return;

  function show(text, kind = '') {
    status.textContent = text;
    status.className = 'settings-status' + (kind ? ' is-' + kind : '');
  }

  btn.addEventListener('click', async () => {
    show('Leaflet を読み込み中…', '');
    try {
      await loadMaps();
      show('OK — Leaflet と OpenStreetMap が読み込めました', 'ok');
    } catch (err) {
      show('読み込みに失敗しました: ' + err.message, 'bad');
    }
  });
}
