// Spot picker modal. Uses Leaflet + OpenStreetMap tiles + Nominatim
// for reverse geocoding. No API key required, no account, no age gate.

import { loadMaps, reverseGeocode, reverseGeocodeGSI, pickBuildingName, formatJapanAddress } from '../gmap.js';
import { icon } from '../icons.js';

let rootEl    = null;
let mapInst   = null;
let markerInst = null;
let resolveFn = null;
let pickedPos = null;
let pickedAddress = '';
let pickedAddressDetails = null;
let geocodeSeq = 0;

const TOKYO = { lat: 35.681236, lng: 139.767125 };

function template() {
  return (
    '<div class="modal modal--map" id="spot-picker" hidden>' +
      '<div class="modal__backdrop" data-picker-close></div>' +
      '<div class="modal__card modal__card--map" role="dialog" aria-labelledby="picker-title">' +
        '<header class="picker-head">' +
          '<h2 id="picker-title">場所を選ぶ</h2>' +
          '<button class="modal__close" data-picker-close aria-label="Close">' + icon('close', { size: 18 }) + '</button>' +
        '</header>' +

        '<div class="picker-toolbar">' +
          '<button type="button" class="btn btn--ghost btn--sm" id="picker-geo">' +
            icon('pin', { size: 14, className: 'icon--inline' }) + '現在地を使う' +
          '</button>' +
          '<input type="text" id="picker-label" placeholder="ラベル（任意・建物名や店名）">' +
        '</div>' +

        '<div id="picker-map" class="picker-map"></div>' +

        '<footer class="picker-foot">' +
          '<div class="picker-info">' +
            '<div id="picker-address-meta" class="picker-address-meta"></div>' +
            '<label class="picker-address-field">' +
              '<span class="picker-address-field__label">住所</span>' +
              '<input type="text" id="picker-address-input" class="picker-address-input" ' +
                'placeholder="地図をクリックして取得…" autocomplete="off" spellcheck="false">' +
              '<button type="button" id="picker-address-reset" class="picker-address-reset" hidden title="自動取得に戻す">↺</button>' +
            '</label>' +
            '<div id="picker-address-hint" class="picker-address-hint"></div>' +
            '<div id="picker-coords" class="picker-coords"></div>' +
          '</div>' +
          '<div class="picker-actions">' +
            '<button type="button" class="btn btn--ghost" data-picker-close>Cancel</button>' +
            '<button type="button" class="btn btn--primary" id="picker-confirm" disabled>Confirm</button>' +
          '</div>' +
        '</footer>' +

        '<div id="picker-error" class="picker-error" hidden></div>' +
      '</div>' +
    '</div>'
  );
}

function mount() {
  if (rootEl) return;
  const host = document.createElement('div');
  host.innerHTML = template();
  document.body.appendChild(host.firstElementChild);
  rootEl = document.getElementById('spot-picker');
  rootEl.addEventListener('click', (e) => {
    if (e.target.matches('[data-picker-close]')) close(null);
  });
  document.getElementById('picker-confirm').addEventListener('click', () => {
    if (!pickedPos) return;
    const label = document.getElementById('picker-label').value.trim() || '';
    // The address actually submitted is whatever is currently in the input —
    // user-edited (e.g. "...神宮前6-17-2") wins over the auto-detected text.
    const finalAddress = (document.getElementById('picker-address-input').value || '').trim();
    close({
      lat: pickedPos.lat,
      lng: pickedPos.lng,
      label,
      ...(finalAddress ? { address: finalAddress } : {}),
      ...(pickedAddressDetails ? { addressDetails: pickedAddressDetails } : {}),
    });
  });
  document.getElementById('picker-geo').addEventListener('click', useGeolocation);

  // Restore auto-detected text when the user clicks the ↺ button.
  document.getElementById('picker-address-reset').addEventListener('click', () => {
    const input = document.getElementById('picker-address-input');
    if (!input) return;
    const auto = input.dataset.auto || '';
    input.value = auto;
    document.getElementById('picker-address-reset').hidden = true;
  });

  // Show the ↺ button as soon as the user edits the field.
  document.getElementById('picker-address-input').addEventListener('input', () => {
    const input = document.getElementById('picker-address-input');
    const reset = document.getElementById('picker-address-reset');
    const auto = input.dataset.auto || '';
    reset.hidden = (input.value === auto);
  });
}

function showError(msg) {
  const el = document.getElementById('picker-error');
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function setPick(lat, lng, { autoFillLabel = false } = {}) {
  pickedPos = { lat, lng };
  if (markerInst) markerInst.setLatLng([lat, lng]);
  document.getElementById('picker-coords').textContent =
    'lat ' + lat.toFixed(6) + ', lng ' + lng.toFixed(6);
  document.getElementById('picker-confirm').disabled = false;

  pickedAddress = '';
  pickedAddressDetails = null;
  const meta = document.getElementById('picker-address-meta');
  const hint = document.getElementById('picker-address-hint');
  if (meta) meta.innerHTML = '';
  if (hint) {
    hint.textContent = '住所を取得中…';
    hint.className   = 'picker-address-hint is-loading';
  }
  doReverseGeocode(lat, lng, autoFillLabel);
}

async function doReverseGeocode(lat, lng, autoFillLabel) {
  const seq = ++geocodeSeq;
  // Call OSM/Nominatim + GSI in parallel. GSI fills in the 大字・町丁目
  // when Nominatim only knew the ward. Either may legitimately fail
  // (network, outside Japan, etc.) — handle separately.
  const [nomRes, gsiRes] = await Promise.allSettled([
    reverseGeocode(lat, lng),
    reverseGeocodeGSI(lat, lng),
  ]);
  if (seq !== geocodeSeq) return;

  const hint  = document.getElementById('picker-address-hint');
  const meta  = document.getElementById('picker-address-meta');
  const input = document.getElementById('picker-address-input');
  const reset = document.getElementById('picker-address-reset');

  if (nomRes.status !== 'fulfilled' && gsiRes.status !== 'fulfilled') {
    if (hint) {
      hint.textContent = '住所の取得に失敗しました（ネットワーク？）';
      hint.className = 'picker-address-hint is-bad';
    }
    return;
  }

  const data = nomRes.status === 'fulfilled' ? nomRes.value : {};
  const gsi  = gsiRes.status === 'fulfilled' ? gsiRes.value : null;
  const building = pickBuildingName(data);
  const det      = formatJapanAddress(data, gsi);
  const address  = det.full || data.display_name || '';
  pickedAddress = address;
  pickedAddressDetails = det;

  if (meta) {
    const chips = [];
    if (det.postcode) chips.push('<span class="picker-chip">〒' + escapeHtml(det.postcode) + '</span>');
    if (building)     chips.push('<span class="picker-chip picker-chip--strong">' + escapeHtml(building) + '</span>');
    meta.innerHTML = chips.join('');
  }
  if (input) {
    // Only overwrite the field if the user hasn't typed into it (i.e. its
    // current value is empty or matches the previous auto-fill). Otherwise
    // they've already started writing "6-17-2…" and we'd be clobbering them.
    const prevAuto = input.dataset.auto || '';
    if (!input.value || input.value === prevAuto) {
      input.value = address;
    }
    input.dataset.auto = address;
    if (reset) reset.hidden = (input.value === address);
  }
  if (hint) {
    if (det.houseNumber) {
      hint.textContent = '番地: ' + det.houseNumber + '（自動取得）';
      hint.className = 'picker-address-hint';
    } else if (address) {
      hint.textContent = '⚠ 番地は自動取得できませんでした — 上の住所欄に「6-17-2」など追記してください';
      hint.className = 'picker-address-hint is-warn';
    } else {
      hint.textContent = '住所が見つかりません — 上の住所欄に直接入力してください';
      hint.className = 'picker-address-hint is-warn';
    }
  }

  if (autoFillLabel) {
    const labelInput = document.getElementById('picker-label');
    if (labelInput && !labelInput.value.trim()) {
      labelInput.value = building || (address.split(/[、,\s]\s*/)[0] || '');
    }
  }
}

async function initMap() {
  showError('');
  let L;
  try {
    L = await loadMaps();
  } catch (err) {
    showError('地図ライブラリの読み込みに失敗しました: ' + err.message + '（ネットワーク接続を確認してください）');
    return;
  }
  const container = document.getElementById('picker-map');
  if (!container) return;

  mapInst = L.map(container, { zoomControl: true }).setView([TOKYO.lat, TOKYO.lng], 16);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(mapInst);

  markerInst = L.marker([TOKYO.lat, TOKYO.lng], { draggable: true }).addTo(mapInst);

  setPick(TOKYO.lat, TOKYO.lng);

  mapInst.on('click', (ev) => {
    setPick(ev.latlng.lat, ev.latlng.lng);
  });
  markerInst.on('dragend', () => {
    const ll = markerInst.getLatLng();
    setPick(ll.lat, ll.lng);
  });

  // Leaflet measures container at init; redraw once visible so tiles fill it.
  setTimeout(() => mapInst.invalidateSize(), 60);
}

function useGeolocation() {
  if (!navigator.geolocation) {
    showError('このブラウザは Geolocation に対応していません');
    return;
  }
  showError('現在地を取得中…');

  function onSuccess(pos) {
    showError('');
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    if (mapInst) mapInst.setView([lat, lng], 18);
    setPick(lat, lng, { autoFillLabel: true });
  }

  // First pass: fast WiFi / IP geolocation (no GPS), allow a 5-min
  // cached fix. Most desktops can't do GPS at all, so this is the only
  // thing that ever resolves there.
  navigator.geolocation.getCurrentPosition(
    onSuccess,
    (err) => {
      // PERMISSION_DENIED (code 1) won't get any better with a retry.
      if (err.code === 1) {
        showError('位置情報の利用が許可されていません。ブラウザの設定を確認してください。');
        return;
      }
      // Position unavailable / timeout → retry with high accuracy and
      // a much longer window. On phones this kicks the GPS in.
      showError('現在地を再取得中…（高精度モード）');
      navigator.geolocation.getCurrentPosition(
        onSuccess,
        (err2) => {
          showError('現在地を取得できませんでした: ' + (err2.message || 'timeout') +
                    '。手動で地図上をクリックして場所を選んでください。');
        },
        { enableHighAccuracy: true, timeout: 25000, maximumAge: 60000 }
      );
    },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 }
  );
}

function close(result) {
  if (!rootEl) return;
  rootEl.hidden = true;
  if (resolveFn) { resolveFn(result); resolveFn = null; }
  pickedPos = null;
  pickedAddress = '';
  pickedAddressDetails = null;
}

// Open the picker. Resolves with { lat, lng, label, address, addressDetails }
// or null on cancel.
export function pickSpot() {
  mount();
  showError('');
  pickedPos = null;
  pickedAddress = '';
  pickedAddressDetails = null;
  geocodeSeq++;
  document.getElementById('picker-confirm').disabled = true;
  document.getElementById('picker-coords').textContent       = '';
  document.getElementById('picker-address-meta').innerHTML   = '';
  document.getElementById('picker-address-hint').textContent = '';
  document.getElementById('picker-address-hint').className   = 'picker-address-hint';
  const input = document.getElementById('picker-address-input');
  input.value = '';
  input.dataset.auto = '';
  document.getElementById('picker-address-reset').hidden = true;
  document.getElementById('picker-label').value          = '';
  rootEl.hidden = false;
  setTimeout(initMap, 30);
  return new Promise((res) => { resolveFn = res; });
}
