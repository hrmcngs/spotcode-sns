// Modal that opens a Google Map and lets the user drop a precise pin
// — works at building-zoom and supports geolocation. Resolves with
// { lat, lng, label, address } when the user confirms, or null on cancel.

import { loadMaps, getApiKey } from '../gmap.js';
import { url }                  from '../router.js';
import { icon }                  from '../icons.js';

let rootEl    = null;
let mapInst   = null;
let markerInst = null;
let geocoder  = null;
let resolveFn = null;
let pickedPos = null;
let pickedAddress = '';
let geocodeSeq = 0; // guard against out-of-order responses

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
          '<input type="text" id="picker-label" placeholder="ラベル（任意・建物名や店名）">' +
        '</div>' +

        '<div id="picker-map" class="picker-map"></div>' +

        '<footer class="picker-foot">' +
          '<div class="picker-info">' +
            '<div id="picker-address" class="picker-address"></div>' +
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
    close({
      lat: pickedPos.lat,
      lng: pickedPos.lng,
      label,
      address: pickedAddress || undefined,
    });
  });
  document.getElementById('picker-geo').addEventListener('click', useGeolocation);
}

function showError(msg) {
  const el = document.getElementById('picker-error');
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}

function setPick(lat, lng, opts = {}) {
  pickedPos = { lat, lng };
  if (markerInst) markerInst.setPosition({ lat, lng });
  document.getElementById('picker-coords').textContent =
    'lat ' + lat.toFixed(6) + ', lng ' + lng.toFixed(6);
  document.getElementById('picker-confirm').disabled = false;
  // Reset address pending the geocoder response.
  pickedAddress = '';
  const addrEl = document.getElementById('picker-address');
  if (addrEl) {
    addrEl.textContent = '住所を取得中…';
    addrEl.className   = 'picker-address is-loading';
  }
  reverseGeocode(lat, lng, { autoFillLabel: !!opts.autoFillLabel });
}

// Pick a "building" name from the geocoder result. Prefer establishment /
// point_of_interest / premise types; fall back to the first formatted
// component before the city. Returns '' when nothing reasonable found.
function pickBuildingName(results) {
  if (!Array.isArray(results) || !results.length) return '';
  const preferredTypes = ['establishment', 'point_of_interest', 'premise', 'subpremise'];
  for (const r of results) {
    if (r.types && r.types.some(t => preferredTypes.includes(t))) {
      // The first short address component is usually the building.
      const comp = r.address_components?.[0];
      if (comp) return comp.long_name;
    }
  }
  // Some geocoder responses surface a building inside address_components.
  for (const r of results) {
    const buildingComp = r.address_components?.find(c =>
      c.types?.some(t => preferredTypes.includes(t))
    );
    if (buildingComp) return buildingComp.long_name;
  }
  return '';
}

async function reverseGeocode(lat, lng, { autoFillLabel } = {}) {
  if (!geocoder) return;
  const seq = ++geocodeSeq;

  let response;
  try {
    response = await geocoder.geocode({ location: { lat, lng } });
  } catch (err) {
    if (seq !== geocodeSeq) return;
    const addrEl = document.getElementById('picker-address');
    if (addrEl) {
      addrEl.textContent = err?.code === 'ZERO_RESULTS'
        ? '住所が見つかりません'
        : '住所の取得に失敗しました（Geocoding API が有効か確認）';
      addrEl.className = 'picker-address is-bad';
    }
    return;
  }
  if (seq !== geocodeSeq) return; // a newer click superseded us

  const results = response?.results || [];
  if (!results.length) {
    const addrEl = document.getElementById('picker-address');
    if (addrEl) { addrEl.textContent = '住所が見つかりません'; addrEl.className = 'picker-address is-bad'; }
    return;
  }

  const address  = results[0].formatted_address || '';
  const building = pickBuildingName(results);
  pickedAddress = address;

  const addrEl = document.getElementById('picker-address');
  if (addrEl) {
    addrEl.innerHTML =
      (building ? '<strong>' + escapeHtml(building) + '</strong>' : '') +
      (building && address ? '<br>' : '') +
      (address ? '<span>' + escapeHtml(address) + '</span>' : '');
    addrEl.className = 'picker-address';
  }

  // Auto-fill the label only when the user hasn't typed anything,
  // so we never overwrite their input.
  if (autoFillLabel) {
    const labelInput = document.getElementById('picker-label');
    if (labelInput && !labelInput.value.trim()) {
      labelInput.value = building || address.split(/[、,]\s*/)[0] || '';
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
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

  geocoder = new maps.Geocoder();

  // Initial pick: center
  setPick(TOKYO.lat, TOKYO.lng);

  mapInst.addListener('click', (ev) => {
    setPick(ev.latLng.lat(), ev.latLng.lng());
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
      // When the user explicitly asks for "current location", auto-fill the
      // label with the resolved building name (if the label is empty).
      setPick(lat, lng, { autoFillLabel: true });
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
  pickedAddress = '';
}

// Open the picker. Resolves with { lat, lng, label, address } or null on cancel.
export function pickSpot() {
  mount();
  showError('');
  pickedPos = null;
  pickedAddress = '';
  geocodeSeq++;
  document.getElementById('picker-confirm').disabled = true;
  document.getElementById('picker-coords').textContent  = '';
  document.getElementById('picker-address').textContent = '';
  document.getElementById('picker-address').className   = 'picker-address';
  document.getElementById('picker-label').value         = '';
  rootEl.hidden = false;
  // Defer the map init so the modal has dimensions when Google Maps measures.
  setTimeout(initMap, 30);
  return new Promise((res) => { resolveFn = res; });
}

export function hasApiKey() {
  return !!getApiKey();
}
