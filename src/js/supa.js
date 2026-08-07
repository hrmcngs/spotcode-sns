// Supabase client wrapper. The SDK is loaded lazily from esm.sh on first
// use, so the static site has zero up-front cost.
//
// Credential resolution order:
//   1. localStorage override (set via /settings — for users running their
//      own Supabase project)
//   2. Baked-in defaults in supa-config.js — the shared spotcode-sns
//      project that ships with the deployment
//
// Only "publishable" / anon keys ever live here; the secret/service_role
// key must never reach the browser.

import { KEYS, read, write, remove } from './storage.js';
import { SUPA_URL as DEFAULT_URL, SUPA_ANON as DEFAULT_ANON } from './supa-config.js';

// Pin a known-good supabase-js version rather than tracking the @2
// floating tag. esm.sh's @2 resolver started serving 2.108.x, whose
// dependency chain occasionally fails to load end-to-end ("Failed
// to fetch dynamically imported module") — pinning gives a stable
// surface, and the jsdelivr fallback below handles the case where
// esm.sh itself is briefly unreachable from the user's network.
const SDK_VERSION = '2.39.7';
const SDK_URLS = [
  'https://esm.sh/@supabase/supabase-js@' + SDK_VERSION,
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@' + SDK_VERSION + '/+esm',
];

let sdkPromise = null;
let cachedClient = null;
let cachedConfigKey = '';
let clientPromise = null;
let clientPromiseConfigKey = '';
let clientGeneration = 0;

// Per-user override stored in localStorage (empty unless they used /settings).
export function getOverride() {
  return {
    url:     read(KEYS.supaUrl,  '') || '',
    anonKey: read(KEYS.supaAnon, '') || '',
  };
}

// Effective config = override if both fields set, else baked-in defaults.
export function getConfig() {
  const o = getOverride();
  if (o.url && o.anonKey) return o;
  return { url: DEFAULT_URL, anonKey: DEFAULT_ANON };
}

// True when there are baked-in defaults the app can fall back to.
export function hasDefaults() {
  return !!(DEFAULT_URL && DEFAULT_ANON);
}

// True when the *current* effective config has values (whether from
// override or defaults). Practically always true once defaults exist.
export function isConfigured() {
  const c = getConfig();
  return !!(c.url && c.anonKey);
}

// True when the user has explicitly overridden the defaults.
export function isUsingOverride() {
  const o = getOverride();
  return !!(o.url && o.anonKey);
}

export function setConfig({ url, anonKey }) {
  const u = String(url || '').trim();
  const k = String(anonKey || '').trim();
  if (u) write(KEYS.supaUrl, u);   else remove(KEYS.supaUrl);
  if (k) write(KEYS.supaAnon, k);  else remove(KEYS.supaAnon);
  resetClient();
}

function resetClient() {
  clientGeneration++;
  cachedClient = null;
  cachedConfigKey = '';
  clientPromise = null;
  clientPromiseConfigKey = '';
}

export async function loadSdk() {
  if (sdkPromise) return sdkPromise;
  sdkPromise = (async () => {
    let lastErr;
    for (const u of SDK_URLS) {
      try {
        return await import(/* @vite-ignore */ u);
      } catch (err) {
        lastErr = err;
        // Try the next CDN. If all of them fail, surface the last
        // error so /settings → 接続テスト can show something useful.
      }
    }
    // Reset so the next call retries (e.g. transient network blip
    // resolves and the user clicks login again).
    sdkPromise = null;
    throw lastErr || new Error('Failed to load supabase-js from any CDN');
  })();
  return sdkPromise;
}

// Returns a memoised Supabase client, building it on demand. Throws when
// the URL / anon key are missing so callers can route the user to /settings.
export async function getClient() {
  const { url, anonKey } = getConfig();
  if (!url || !anonKey) throw new Error('NO_CONFIG');
  const configKey = url + ' ' + anonKey;
  if (cachedClient && cachedConfigKey === configKey) return cachedClient;
  // Do not only memoise the completed client: initAuth, schema probing,
  // follows and the first timeline fetch all call getClient during boot.
  // They used to pass the cachedClient check together, await the same SDK,
  // and then each create their own GoTrueClient with the same storage key.
  if (clientPromise && clientPromiseConfigKey === configKey) return clientPromise;

  const generation = clientGeneration;
  const pending = (async () => {
    const sdk = await loadSdk();
    // setConfig/resetClient may have run while the CDN import was pending.
    // Never publish a client created for stale credentials.
    if (generation !== clientGeneration) throw new Error('CLIENT_RESET');
    const client = sdk.createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    cachedClient = client;
    cachedConfigKey = configKey;
    return client;
  })();
  clientPromise = pending;
  clientPromiseConfigKey = configKey;
  try {
    return await pending;
  } finally {
    // Only clear our own slot. A config reset may already have installed a
    // newer promise, which this older request must not erase.
    if (clientPromise === pending) {
      clientPromise = null;
      clientPromiseConfigKey = '';
    }
  }
}

// Light connection probe — confirms the URL responds and the anon key is
// accepted. Doesn't require any specific table to exist.
export async function ping() {
  const client = await getClient();
  const r = await client.from('_spotcode_ping_').select('*').limit(0);
  if (r.error && /JWT|key|auth/i.test(r.error.message)) {
    throw new Error('AUTH_FAILED');
  }
  return true;
}
