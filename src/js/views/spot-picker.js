// Modal that opens a Google Map and lets the user drop a precise pin
// — works at building-zoom and supports geolocation. Resolves with
// { lat, lng, label } when the user confirms, or null when cancelled.

import { loadMaps, getApiKey } from '../gmap.js';
import { url }                  from '../router.js';
import { icon }                  from '../icons.js';

let rootEl    = null;
let mapInst   = null;
let markerInst = null;
let resolveFn = null;
let pickedPos = null;

const TOKYO = { lat: 35.681236, lng: 139.767125 }; // fallback center

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
          '<input type="text" id="picker-label" placeholder="ラベル（任意）例: スタバ 渋谷店">' +
        '</div>' +

        '<div id="picker-map" class="picker-map"></div>' +

        '<footer class="picker-foot">' +
          '<div id="picker-coords" class="picker-coords"></div>' +
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
    close({ lat: pickedPos.lat, lng: pickedPos.lng, label });
  });
  document.getElementById('picker-geo').addEventListener('click', useGeolocation);
}

function showError(msg) {
  const el = document.getElementById('picker-error');
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}

function setPick(lat, lng) {
  pickedPos = { lat, lng };
  if (markerInst) markerInst.setPosition({ lat, lng });
  document.getElementById('picker-coords').textContent =
    'lat ' + lat.toFixed(6) + ', lng ' + lng.toFixed(6);
  document.getElementById('picker-confirm').disabled = false;
}

async function initMap() {
  showError('');
  let maps;
  try {
    maps = await loadMaps();
  } catch (err) {
    if (err.message === 'NO_KEY') {
      showError('Google Maps API キーが未設定です。Settings から登録してください。');
      const goSettings = document.createElement('a');
      goSettings.href = url('/settings');
      goSettings.className = 'btn btn--primary btn--sm';
      goSettings.style.marginLeft = '.5rem';
      goSettings.textContent = 'Settings →';
      document.getElementById('picker-error').appendChild(goSettings);
    } else {
      showError('Maps の読み込みに失敗しました: ' + err.message);
    }
    return;
  }

  const container = document.getElementById('picker-map');
  if (!container) return;

  mapInst = new maps.Map(container, {
    center: TOKYO,
    zoom: 16,
    streetViewControl: false,
    mapTypeControl: false,
    fullscreenControl: false,
    clickableIcons: false,
    gestureHandling: 'greedy',
  });

  markerInst = new maps.Marker({
    map: mapInst,
    position: TOKYO,
    draggable: true,
  });

  // Initial pick: center
  setPick(TOKYO.lat, TOKYO.lng);

  mapInst.addListener('click', (ev) => {
    const lat = ev.latLng.lat();
    const lng = ev.latLng.lng();
    setPick(lat, lng);
  });
  markerInst.addListener('dragend', () => {
    const p = markerInst.getPosition();
    setPick(p.lat(), p.lng());
  });
}

function useGeolocation() {
  if (!navigator.geolocation) {
    showError('このブラウザは Geolocation に対応していません');
    return;
  }
  showError('現在地を取得中…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      showError('');
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      if (mapInst) {
        mapInst.setCenter({ lat, lng });
        mapInst.setZoom(18);
      }
      setPick(lat, lng);
    },
    (err) => {
      showError('現在地を取得できませんでした: ' + err.message);
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
  );
}

function close(result) {
  if (!rootEl) return;
  rootEl.hidden = true;
  if (resolveFn) { resolveFn(result); resolveFn = null; }
  pickedPos = null;
}

// Open the picker. Resolves with { lat, lng, label } or null on cancel.
export function pickSpot() {
  mount();
  showError('');
  pickedPos = null;
  document.getElementById('picker-confirm').disabled = true;
  document.getElementById('picker-coords').textContent = '';
  document.getElementById('picker-label').value = '';
  rootEl.hidden = false;
  // Defer the map init so the modal has dimensions when Google Maps measures.
  setTimeout(initMap, 30);
  return new Promise((res) => { resolveFn = res; });
}

export function hasApiKey() {
  return !!getApiKey();
}
