// Spot picker modal. Uses Leaflet + OpenStreetMap tiles + Nominatim
// for reverse geocoding. No API key required, no account, no age gate.

import { loadMaps, reverseGeocode, reverseGeocodeGSI, pickBuildingName, formatJapanAddress } from '../gmap.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock.js';
import { isDevMode } from '../dev-mode.js';

let rootEl    = null;
let mapInst   = null;
let markerInst = null;
let radiusCircle = null;
let resolveFn = null;
let pickedPos = null;
let pickedAddress = '';
let pickedAddressDetails = null;
let geocodeSeq = 0;
// Anchor position the non-dev radius is measured from. Set when
// useGeolocation() succeeds; null until then (confirm stays disabled).
let geoAnchor = null;

const TOKYO = { lat: 35.681236, lng: 139.767125 };
// How far a non-dev user can drift the pin away from the device's
// real geolocation. 50m covers "the right entrance of this building"
// without enabling location spoofing. Dev mode ignores this.
const NON_DEV_RADIUS_M = 50;

function template() {
  return (
    '<div class="modal modal--map" id="spot-picker" hidden>' +
      '<div class="modal__backdrop" data-picker-close></div>' +
      '<div class="modal__card modal__card--map" role="dialog" aria-labelledby="picker-title">' +
        '<header class="picker-head">' +
          '<h2 id="picker-title">' + t('picker.title') + '</h2>' +
          '<button class="modal__close" data-picker-close aria-label="Close">' + icon('close', { size: 18 }) + '</button>' +
        '</header>' +

        '<div class="picker-toolbar">' +
          '<button type="button" class="btn btn--ghost btn--sm" id="picker-geo">' +
            icon('pin', { size: 14, className: 'icon--inline' }) + t('picker.use_geo') +
          '</button>' +
          '<input type="text" id="picker-label" placeholder="' + t('picker.label_placeholder') + '">' +
        '</div>' +

        // Only shown when isDevMode() is false (set by mount()). Tells the
        // user the pin will track their actual location and other taps
        // on the map are ignored, so they don't waste time trying.
        '<div id="picker-locked-hint" class="picker-locked-hint" hidden>' +
          icon('pin', { size: 14, className: 'icon--inline' }) +
          '<span>' + t('picker.locked_to_geo') + '</span>' +
        '</div>' +

        '<div id="picker-map" class="picker-map"></div>' +

        '<footer class="picker-foot">' +
          '<div class="picker-info">' +
            '<div id="picker-address-meta" class="picker-address-meta"></div>' +
            '<label class="picker-address-field">' +
              '<span class="picker-address-field__label">' + t('picker.address') + '</span>' +
              '<input type="text" id="picker-address-input" class="picker-address-input" ' +
                'placeholder="' + t('picker.address_placeholder') + '" autocomplete="off" spellcheck="false">' +
              '<button type="button" id="picker-address-reset" class="picker-address-reset" hidden title="' + t('picker.reset_auto') + '">↺</button>' +
            '</label>' +
            '<div id="picker-address-hint" class="picker-address-hint"></div>' +
            '<div id="picker-coords" class="picker-coords"></div>' +
          '</div>' +
          '<div class="picker-actions">' +
            '<button type="button" class="btn btn--ghost" data-picker-close>' + t('picker.cancel') + '</button>' +
            '<button type="button" class="btn btn--primary" id="picker-confirm" disabled>' + t('picker.confirm') + '</button>' +
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
      hint.textContent = t('picker.hint.house', { n: det.houseNumber });
      hint.className = 'picker-address-hint';
    } else if (address) {
      hint.textContent = t('picker.hint.no_house');
      hint.className = 'picker-address-hint is-warn';
    } else {
      hint.textContent = t('picker.hint.no_address');
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

// Draw / update the soft-coloured circle that shows the allowed
// fine-tune area to a non-dev user. Skipped entirely in dev mode
// — there are no bounds and a circle would be misleading. Reuses
// the radiusCircle layer when it already exists so opening the
// picker twice doesn't pile circles up on the map.
function drawRadius(lat, lng) {
  if (isDevMode() || !mapInst || !window.L) return;
  const L = window.L;
  if (radiusCircle) {
    radiusCircle.setLatLng([lat, lng]);
    return;
  }
  radiusCircle = L.circle([lat, lng], {
    radius: NON_DEV_RADIUS_M,
    color: 'rgba(29,155,240,.55)',
    weight: 1,
    fillColor: 'rgba(29,155,240,.12)',
    fillOpacity: 1,
    interactive: false,
  }).addTo(mapInst);
}

// Constrain a candidate position to within NON_DEV_RADIUS_M of the
// geolocation anchor. If the candidate is inside the circle it's
// returned unchanged; outside, we snap to the point on the circle
// boundary along the same bearing. Returns the candidate verbatim
// in dev mode (no anchor to measure against).
function constrainToRadius(L, lat, lng) {
  if (isDevMode() || !geoAnchor) return { lat, lng };
  const anchor = L.latLng(geoAnchor.lat, geoAnchor.lng);
  const target = L.latLng(lat, lng);
  const dist = anchor.distanceTo(target);
  if (dist <= NON_DEV_RADIUS_M) return { lat, lng };
  // Snap to the boundary: interpolate along the line from anchor to
  // target so the snapped point is the closest legal one.
  const ratio = NON_DEV_RADIUS_M / dist;
  return {
    lat: anchor.lat + (target.lat - anchor.lat) * ratio,
    lng: anchor.lng + (target.lng - anchor.lng) * ratio,
  };
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

  // Dev mode unlocks the radius constraint entirely; everyone else
  // can still fine-tune the pin, but only within NON_DEV_RADIUS_M of
  // the device's geolocation. The marker is always draggable so the
  // "tap-and-hold" gesture works on phones — the snap-back logic in
  // dragend enforces the bound.
  const dev = isDevMode();

  mapInst = L.map(container, { zoomControl: true }).setView([TOKYO.lat, TOKYO.lng], 16);

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(mapInst);

  markerInst = L.marker([TOKYO.lat, TOKYO.lng], { draggable: true }).addTo(mapInst);

  mapInst.on('click', (ev) => {
    // Non-dev: ignore clicks outside the radius — snapping a click
    // 500m away to the boundary is more confusing than helpful.
    if (!dev && geoAnchor) {
      const dist = L.latLng(geoAnchor.lat, geoAnchor.lng)
                    .distanceTo(L.latLng(ev.latlng.lat, ev.latlng.lng));
      if (dist > NON_DEV_RADIUS_M) return;
    }
    setPick(ev.latlng.lat, ev.latlng.lng);
  });
  markerInst.on('dragend', () => {
    const ll = markerInst.getLatLng();
    // Snap the marker back onto the circle if it left the bounds.
    // Dragging is interactive so visualising the snap matters more
    // than for clicks (which we silently ignore above).
    const constrained = constrainToRadius(L, ll.lat, ll.lng);
    if (constrained.lat !== ll.lat || constrained.lng !== ll.lng) {
      markerInst.setLatLng([constrained.lat, constrained.lng]);
    }
    setPick(constrained.lat, constrained.lng);
  });

  if (dev) {
    // Dev convenience: seed a pin at the default centre so confirm is
    // immediately available. Non-dev users have to fetch their actual
    // location first — confirm stays disabled until that lands.
    setPick(TOKYO.lat, TOKYO.lng);
  } else {
    // Auto-trigger the geolocation flow on open so the picker is
    // useful without an extra tap. useGeolocation already handles
    // the permission-denied / timeout cases and sets geoAnchor.
    useGeolocation();
  }

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
    // Anchor non-dev radius enforcement to whatever geolocation
    // returns. The marker can drift within NON_DEV_RADIUS_M of this
    // point; further away and dragend snaps back / clicks are ignored.
    geoAnchor = { lat, lng };
    if (mapInst) {
      mapInst.setView([lat, lng], 18);
      drawRadius(lat, lng);
    }
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
  if (!rootEl || rootEl.hidden) return;
  rootEl.hidden = true;
  unlockBodyScroll();
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
  geoAnchor = null;
  // Drop any radius overlay left over from a previous session. A
  // fresh anchor (or dev mode) will redraw / suppress it.
  if (radiusCircle && mapInst) {
    try { mapInst.removeLayer(radiusCircle); } catch {}
    radiusCircle = null;
  }
  // Re-evaluate dev mode every open — the toggle in /settings can
  // flip between picker invocations and the hint needs to follow.
  const lockedHint = document.getElementById('picker-locked-hint');
  if (lockedHint) lockedHint.hidden = isDevMode();
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
  lockBodyScroll();
  setTimeout(initMap, 30);
  return new Promise((res) => { resolveFn = res; });
}
