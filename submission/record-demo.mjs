import { mkdir, writeFile } from 'node:fs/promises';

const outDir = '/tmp/spotcode-demo-frames';
await mkdir(outDir, { recursive: true });
const loginId = process.env.SPOTCODE_LOGIN || '';
const loginPassword = process.env.SPOTCODE_PASSWORD || '';
if (!loginId || !loginPassword) throw new Error('Login credentials were not provided');

const pages = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
const page = pages.find(p => p.type === 'page');
if (!page) throw new Error('Chrome page not found');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
ws.addEventListener('message', event => {
  const msg = JSON.parse(event.data);
  if (!msg.id || !pending.has(msg.id)) return;
  const { resolve, reject } = pending.get(msg.id);
  pending.delete(msg.id);
  msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
});

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const run = expression => send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1280, height: 720, deviceScaleFactor: 1, mobile: false,
});
await send('Browser.grantPermissions', {
  origin: 'http://127.0.0.1:8080',
  permissions: ['geolocation'],
});
await send('Emulation.setGeolocationOverride', {
  // Use a public landmark in the submission recording so no school is shown.
  latitude: 35.681236,
  longitude: 139.767125,
  accuracy: 12,
});
await send('Page.navigate', { url: 'http://127.0.0.1:8080/' });
await sleep(3000);

// Authenticate through the real login form when this recording profile does
// not already hold a valid session. Credentials are never written to disk.
let loggedIn = (await run(`!!document.querySelector('.composer:not(.composer--gated)')`)).result.value;
if (!loggedIn) {
  await run(`document.querySelector('[data-auth="login"]')?.click()`);
  await sleep(500);
  await run(`(() => {
    const email = document.querySelector('#auth-login-email');
    const password = document.querySelector('#auth-login-password');
    email.value = ${JSON.stringify(loginId)};
    password.value = ${JSON.stringify(loginPassword)};
    email.dispatchEvent(new Event('input', { bubbles: true }));
    password.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('form[data-pane="login"] button[type="submit"]')?.click();
  })()`);

  for (let i = 0; i < 30; i++) {
    await sleep(700);
    const state = await run(`({
      authenticated: !!document.querySelector('.composer:not(.composer--gated)'),
      error: document.querySelector('form[data-pane="login"] [data-error]')?.textContent || ''
    })`);
    if (state.result.value.authenticated) { loggedIn = true; break; }
    if (state.result.value.error) throw new Error('Login failed: ' + state.result.value.error);
  }
}
if (!loggedIn) throw new Error('Login timed out');

// Enable anonymisation before recording starts, then render the home view.
// The setup screen itself is intentionally not included in the submission.
await run(`localStorage.setItem('spotcode:privacy-mode', '1')`);
await run(`document.querySelector('a[data-route="/"]')?.click()`);
await sleep(2200);
// Repository URLs can contain identifying account/repository names. Hide
// those link rows only in the privacy-safe recording view.
await run(`(() => { const style = document.createElement('style'); style.textContent = '.post__link{display:none!important}'; document.head.appendChild(style); })()`);

const actions = new Map([
  [25, `(() => { const el = document.querySelector('.composer textarea'); if (!el) return; el.focus(); el.value = '今日は散歩日和でした。'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`],
  [48, `document.querySelector('#compose-spot-btn')?.click()`],
  [78, `document.querySelector('#picker-geo')?.click()`],
  [105, `(() => { const label = document.querySelector('#picker-label'); if (label) { label.value = 'いまここ'; label.dispatchEvent(new Event('input', { bubbles: true })); } document.querySelector('#picker-confirm:not([disabled])')?.click(); })()`],
  [128, `document.querySelector('#compose-kind-toggle')?.click()`],
  [145, `document.querySelector('.composer button[type="submit"]')?.click()`],
]);

for (let frame = 0; frame < 270; frame++) {
  if (actions.has(frame)) {
    await run(actions.get(frame));
    await sleep(450);
  }
  const shot = await send('Page.captureScreenshot', {
    format: 'jpeg', quality: 88, fromSurface: true,
  });
  await writeFile(`${outDir}/frame-${String(frame).padStart(4, '0')}.jpg`, Buffer.from(shot.data, 'base64'));
  await sleep(100);
}

ws.close();
console.log(`captured 270 frames in ${outDir}`);
