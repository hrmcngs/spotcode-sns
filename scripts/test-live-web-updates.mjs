import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const source = fs.readFileSync('src/sw.js', 'utf8');
function worker({ offline = false, cached, index, host = 'hrmcngs.github.io' } = {}) {
  const events = {}, calls = [], writes = [];
  const context = vm.createContext({ URL, Response, AbortController, Promise, setTimeout, clearTimeout,
    self: { location: { origin: 'https://' + host, hostname: host }, addEventListener: (name, fn) => { events[name] = fn; } },
    caches: { match: async req => req === './index.html' ? index : cached,
      open: async () => ({ put: async (...args) => { writes.push(args); } }) },
    fetch: async (req, options) => {
      calls.push({ req, options });
      if (offline) throw new Error('offline');
      return { status: 200, type: 'basic', text: async () => 'fresh', clone() { return this; } };
    },
  });
  vm.runInContext(source, context);
  return { calls, writes, async request(pathname, options = {}) {
    let response;
    events.fetch({ request: { method: 'GET', url: 'https://' + host + pathname, mode: 'cors', destination: '', ...options }, respondWith: value => { response = value; } });
    return response;
  } };
}
const old = new Response('old'), offlineIndex = new Response('offline index');
for (const asset of ['/spotcode-sns/css/style.css', '/spotcode-sns/js/main.js', '/spotcode-sns/manifest.json']) {
  const w = worker({ cached: old });
  const result = await w.request(asset);
  assert.equal(await result.text(), 'fresh');
  assert.equal(w.calls[0].options.cache, 'no-cache');
  assert.equal(w.writes.length, 1);
}
let w = worker({ offline: true, cached: old });
assert.equal(await w.request('/spotcode-sns/js/main.js'), old, 'offline modules retain their own cached response');
w = worker({ offline: true, index: offlineIndex });
assert.equal((await w.request('/spotcode-sns/js/missing.js')).status, 504, 'never substitute HTML for JavaScript');
assert.equal(await w.request('/spotcode-sns/', { mode: 'navigate', destination: 'document' }), offlineIndex);
w = worker({ cached: old });
assert.equal(await w.request('/spotcode-sns/favicon.svg'), old);
assert.equal(w.calls.length, 0, 'unchanged images use their cache');
assert.equal(await w.request('/spotcode-sns/', { method: 'POST' }), undefined);
assert.equal(await w.request('/unused', { url: 'https://example.com/tile.png' }), undefined);
assert.equal(await worker({ host: 'localhost' }).request('/js/main.js'), undefined);
console.log('PASS fresh HTML/JS/CSS/JSON, offline fallback, no HTML-as-JS, image cache, POST/cross-origin/dev bypass');

const native = fs.readFileSync('ios/App/App/LiveWebApp.swift', 'utf8');
const policy = native.slice(native.indexOf('enum LiveWebPolicy'), native.indexOf('@MainActor'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotcode-live-web-'));
try {
  const test = path.join(dir, 'policy.swift');
  fs.writeFileSync(test, `import Foundation\nenum SupabaseService { static let defaultProjectURL = "https://vkwdthjiyxrhskdlgexq.supabase.co" }\n${policy}\n
for path in ["https://hrmcngs.github.io/spotcode-sns/", "https://hrmcngs.github.io/spotcode-sns/#/settings", "https://hrmcngs.github.io/spotcode-sns/?code=example", "https://hrmcngs.github.io:443/spotcode-sns/"] {
    assert(LiveWebPolicy.isApp(URL(string: path)!))
}
for path in ["http://hrmcngs.github.io/spotcode-sns/", "https://hrmcngs.github.io/another-app/", "https://hrmcngs.github.io/spotcode-sns-evil/", "https://hrmcngs.github.io.evil.test/spotcode-sns/", "https://hrmcngs.github.io:444/spotcode-sns/", "https://hrmcngs.github.io/spotcode-sns/../other/", "https://hrmcngs.github.io/spotcode-sns/%2e%2e/other/", "file:///spotcode-sns/"] {
    assert(!LiveWebPolicy.isApp(URL(string: path)!), path)
}
for path in ["https://github.com/login/oauth/authorize", "https://github.com/session", "https://github.com/sessions/two-factor", "https://vkwdthjiyxrhskdlgexq.supabase.co/auth/v1/callback"] {
    assert(LiveWebPolicy.isAuthentication(URL(string: path)!), path)
}
for path in ["https://github.com/owner/repo", "https://evil.supabase.co/auth/v1/authorize", "http://github.com/login", "https://github.com:444/login", "https://vkwdthjiyxrhskdlgexq.supabase.co/rest/v1/posts"] {
    assert(!LiveWebPolicy.isAuthentication(URL(string: path)!), path)
}
print("PASS app path/origin boundaries, HTTPS, port/traversal rejection, OAuth routing")
`);
  const result = spawnSync('swift', ['-module-cache-path', path.join(os.tmpdir(), 'spotcode-swift-cache'), test], { stdio: 'inherit' });
  if (result.status !== 0) process.exitCode = result.status || 1;
} finally { fs.rmSync(dir, { recursive: true, force: true }); }

if (process.env.PLAYWRIGHT_MODULE) {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
  try {
    const page = await browser.newPage();
    const script = native.match(/let script = """\n([\s\S]*?)\n\s*"""/)[1];
    const dirty = () => page.evaluate(script);
    await page.setContent('<textarea></textarea><input type="file"><select><option>public</option><option>only_me</option></select>');
    assert.equal(await dirty(), false);
    await page.fill('textarea', 'Unsaved text');
    assert.equal(await dirty(), true);
    await page.fill('textarea', '');
    await page.selectOption('select', 'only_me');
    assert.equal(await dirty(), true);
    await page.selectOption('select', 'public');
    assert.equal(await dirty(), false);
    await page.setContent('<div class="post__edit-input"></div>');
    assert.equal(await dirty(), true);
    await page.setContent('<div class="compose-photo"></div>');
    assert.equal(await dirty(), true);
    await page.setContent('<main>Another route</main>');
    await page.evaluate(() => { window.__spotcodeHasUnsavedAttachments = () => true; });
    assert.equal(await dirty(), true, 'attachments remain protected after navigation');
    console.log('PASS native refresh guard: blank forms, text, audience, post editor, photos, offscreen attachments');
  } finally { await browser.close(); }
}
