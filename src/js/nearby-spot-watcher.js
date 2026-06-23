// Periodic "nearby spot" detector. While the tab is visible and push
// is enabled, sample geolocation every few minutes, compare against
// the spots in the home timeline cache, and fire an OS banner when a
// spot enters detection range. Per-session dedupe keeps the same spot
// from firing again every poll while the user is standing next to it.
//
// Why client-side polling and not a server push: the server has no
// idea where the user physically is right now. Any "spot near you"
// signal has to start from the device's geolocation, so we do the
// distance compute right here from cached posts (already-loaded
// timelines) and fire when there's a hit.
//
// Battery: `getCurrentPosition` once every 5 minutes is roughly
// equivalent to a single tap on the OS location indicator — much
// cheaper than `watchPosition`, which streams continuously. We don't
// need sub-minute precision for "is the user walking past a spot"
// — they're going to be there for at least a few minutes.

import { canPush, showPush } from './push-notify.js';
import { cachedPosts } from './data.js';
import { currentUser } from './auth.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000;     // 5 minutes
const NEAR_RADIUS_M    = 150;               // within ~150m counts as "近く"
const POSITION_TIMEOUT = 15 * 1000;

let pollTimer = null;
let stopped   = false;

// Per-session set of spot keys we've already banner'd so the user
// doesn't get the same notification every 5 minutes while walking
// past a single pin. Keyed by post id (each spot post is its own
// entry). Cleared on stopWatcher() so a fresh page also gets a fresh
// dedupe window.
const notifiedSpotIds = new Set();

// Haversine on the equator-mean Earth radius. Same formula as
// geo-gate.js's private `distanceM`; inlined here so we don't widen
// that module's public surface for one consumer.
function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function currentPosition() {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: POSITION_TIMEOUT, maximumAge: 60 * 1000 },
    );
  });
}

// Collect the spot posts the user has VISIBILITY into. Pulled from
// existing localStorage timeline caches so this poll doesn't add a
// Supabase round trip on every tick — by the time the watcher runs,
// the home / following / city scopes are typically already warm.
function candidateSpotPosts() {
  const scopes = ['home', 'following'];
  const seen = new Map(); // post id → post
  for (const scope of scopes) {
    const list = cachedPosts(scope) || [];
    for (const p of list) {
      if (!p || !p.spot) continue;
      if (typeof p.spot.lat !== 'number' || typeof p.spot.lng !== 'number') continue;
      if (!seen.has(p.id)) seen.set(p.id, p);
    }
  }
  return Array.from(seen.values());
}

async function tick() {
  if (stopped) return;
  if (!canPush()) return;
  if (!currentUser()) return;
  if (document.visibilityState !== 'visible') return;

  const here = await currentPosition();
  if (!here) return;

  const candidates = candidateSpotPosts();
  if (!candidates.length) return;

  const base = (window.__BASE__ || '/');
  let hits = 0;
  for (const p of candidates) {
    if (notifiedSpotIds.has(p.id)) continue;
    const d = distanceM(here.lat, here.lng, p.spot.lat, p.spot.lng);
    if (d > NEAR_RADIUS_M) continue;
    // Don't fire on your own spots — the user knows about their own
    // pins; this is for discovering OTHER people's ideas nearby.
    if (p.authorHandle === currentUser().handle) {
      notifiedSpotIds.add(p.id);  // still mark seen so we don't re-check forever
      continue;
    }
    const author = p.author?.name || '@' + (p.authorHandle || '?');
    const where = p.spot.label || p.spot.addressDetails?.city || 'すぐ近く';
    const excerpt = (p.body || '').slice(0, 60);
    showPush('近くに ' + author + ' のアイデアがあります', {
      body: where + (excerpt ? '\n' + excerpt : ''),
      tag: 'nearby:' + p.id,
      url: base + 'post/' + p.id,
      // Even when the tab is focused this one is worth a banner —
      // the user might be reading the timeline without realizing
      // they're standing right next to a spot they're scrolling past.
      skipIfVisible: false,
    });
    notifiedSpotIds.add(p.id);
    hits++;
    if (hits >= 3) break;  // cap per tick — no one wants a banner storm
  }
}

export function startNearbySpotWatcher() {
  if (pollTimer) return;
  stopped = false;
  // First tick delay larger than the notif-poller's so geolocation
  // doesn't pop a permission prompt the instant the user lands on
  // the page. They opted into push in /settings, but the position
  // prompt is a separate OS dialog.
  setTimeout(() => { tick().catch(() => {}); }, 8 * 1000);
  pollTimer = setInterval(() => { tick().catch(() => {}); }, POLL_INTERVAL_MS);
  document.addEventListener('visibilitychange', visibilityKick);
}

export function stopNearbySpotWatcher() {
  stopped = true;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  notifiedSpotIds.clear();
  document.removeEventListener('visibilitychange', visibilityKick);
}

function visibilityKick() {
  // Don't immediately re-poll on every visibility flip — geolocation
  // requests are noticeable on mobile (subtle indicator), and
  // tab-switching is high-frequency. Just let the regular interval
  // catch up on its next tick.
}
