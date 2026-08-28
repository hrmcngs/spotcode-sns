import { mkdir, writeFile } from 'node:fs/promises';

const outDir = '/tmp/spotcode-map-frames';
await mkdir(outDir, { recursive: true });
const pages = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
const page = pages.find(p => p.type === 'page');
if (!page) throw new Error('Chrome page not found');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
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
await send('Browser.grantPermissions', { origin: 'http://127.0.0.1:8080', permissions: ['geolocation'] });
await run(`localStorage.setItem('spotcode:privacy-mode', '1')`);
await run(`(() => { const style = document.createElement('style'); style.textContent = '.post__link,.map-popup__author{display:none!important}'; document.head.appendChild(style); })()`);
await run(`[...document.querySelectorAll('.timeline__head a')].find(a => a.textContent.trim() === 'Spots')?.click()`);
await sleep(3500);

const actions = new Map([
  [28, `(() => { const pins = [...document.querySelectorAll('.leaflet-overlay-pane path.leaflet-interactive')].filter(el => (el.getAttribute('stroke') || '').toLowerCase() === '#f91880'); (pins[1] || pins[0])?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 640, clientY: 360 })); })()`],
  [72, `(() => { document.querySelector('.leaflet-popup-close-button')?.click(); const pins = [...document.querySelectorAll('.leaflet-overlay-pane path.leaflet-interactive')].filter(el => (el.getAttribute('stroke') || '').toLowerCase() === '#f91880'); (pins[pins.length - 1] || pins[0])?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 700, clientY: 360 })); })()`],
]);
for (let frame = 0; frame < 145; frame++) {
  if (actions.has(frame)) { await run(actions.get(frame)); await sleep(550); }
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88, fromSurface: true });
  await writeFile(`${outDir}/frame-${String(frame).padStart(4, '0')}.jpg`, Buffer.from(shot.data, 'base64'));
  await sleep(100);
}
ws.close();
