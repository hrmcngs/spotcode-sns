// Location gating for spot-tagged posts. A post that carries a `spot`
// (lat / lng) is only visible to a viewer who is physically within
// `radiusM` meters of it. Posts without a spot are always visible.
//
// State lives in this module so multiple views share one geolocation
// fix and we don't trigger the permission prompt repeatedly. The
// Haversine distance check is cheap, so filtering happens client-side
// at render time — no SQL change required.

const TTL_MS = 5 * 60 * 1000;
// Default unlock radius for reading a spot's post body. 100m is the
// product spec from the user: pin locations are always public on the
// map, but the body of an idea only unlocks when the viewer walks
// within ~100m of the pin.
let radiusM = 100;
let cached = null;       // { lat, lng, ts } | null
let denied = false;      // true once the user (or system) rejected access
let pending = null;      // in-flight permission request, shared

export function getRadius() { return radiusM; }
export function setRadius(m) { radiusM = Math.max(20, Number(m) || 100); }
export function permissionDenied() { return denied; }
export function cachedLocation() { return cached; }

// Resolve to the viewer's current lat/lng, or null if we can't get one
// (no geolocation API, permission denied, timeout). Cached for 5 minutes
// so the next render doesn't re-ask the browser.
export function getMyLocation() {
  if (cached && Date.now() - cached.ts < TTL_MS) return Promise.resolve(cached);
  if (denied) return Promise.resolve(null);
  if (pending) return pending;
  if (!('geolocation' in navigator)) { denied = true; return Promise.resolve(null); }

  pending = new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        cached = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          ts: Date.now(),
        };
        resolve(cached);
      },
      (err) => {
        // 1 = PERMISSION_DENIED — flag it so we don't re-prompt every render.
        if (err.code === 1) denied = true;
        resolve(null);
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 }
    );
  }).finally(() => { pending = null; });
  return pending;
}

// Haversine distance in meters between two lat/lng pairs.
function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Sync check against the cached fix. Returns:
//   true  — within radius
//   false — outside radius
//   null  — no fix available; caller decides whether to show / hide
export function isNearSpotSync(lat, lng) {
  if (!cached) return null;
  return distanceM(cached.lat, cached.lng, lat, lng) <= radiusM;
}

// Apply the geo gate to a list of posts. Posts without `spot` are kept;
// posts authored by the viewer are kept (you always see your own); other
// spot-tagged posts are kept only when isNearSpotSync returns true.
//
// myHandle is the viewer's handle (string) — pass currentUser().handle.
export function filterPostsByLocation(posts, myHandle) {
  return posts.filter((p) => {
    if (!p.spot) return true;
    if (myHandle && p.authorHandle === myHandle) return true;
    return isNearSpotSync(p.spot.lat, p.spot.lng) === true;
  });
}
