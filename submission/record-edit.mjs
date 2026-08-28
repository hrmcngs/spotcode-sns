import { mkdir, writeFile } from 'node:fs/promises';

const outDir = '/tmp/spotcode-edit-frames';
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
await run(`document.querySelector('a[data-route="/"]')?.click()`);
await sleep(1800);
await run(`(() => { const style = document.createElement('style'); style.textContent = '.post__link{display:none!important}'; document.head.appendChild(style); })()`);

const actions = new Map([
  [18, `(() => { const text = '現在地で見つけた地域のアイデアを記録します。'; const post = [...document.querySelectorAll('[data-post-id]')].find(el => el.textContent.includes(text)); post?.querySelector('.act--edit')?.click(); })()`],
  [42, `(() => { const el = document.querySelector('.post__edit-input'); if (!el) return; el.value = '現在地で見つけた地域のアイデアを記録し、開発につなげます。 #テック甲子園'; el.dispatchEvent(new Event('input', { bubbles: true })); })()`],
  [64, `document.querySelector('.act--edit-save')?.click()`],
  [88, `[...document.querySelectorAll('.timeline__head a')].find(a => a.textContent.trim() === 'Spots')?.click()`],
]);
for (let frame = 0; frame < 110; frame++) {
  if (actions.has(frame)) { await run(actions.get(frame)); await sleep(450); }
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88, fromSurface: true });
  await writeFile(`${outDir}/frame-${String(frame).padStart(4, '0')}.jpg`, Buffer.from(shot.data, 'base64'));
  await sleep(100);
}
ws.close();
