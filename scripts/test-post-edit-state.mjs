import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Exercise the actual update function against a recording database client.
const source = fs.readFileSync('src/js/data.js', 'utf8');
const update = source.slice(source.indexOf('export async function updatePost('), source.indexOf('export async function removePost(')).replace('export ', '');
let payload;
const ctx = vm.createContext({
  currentUser: () => null, captureTimelineContext: () => ({}), assertTimelineContext() {},
  hasRepoFullName: true, hasEventUrl: true, hasKind: true,
  getClient: async () => ({ from: () => ({ update: patch => {
    payload = patch;
    return { eq: () => ({ select: async () => ({ data: [{ id: 'post', ...patch }] }) }) };
  } }) }),
  withResilientCols: fn => fn('*'), shapePost: row => row, removeFromTimelineCaches() {},
  t: text => text,
});
vm.runInContext(update, ctx);
for (const color of ['#ff0000', '#00ff00', '#123456']) {
  const spot = { lat: 35, lng: 139, label: 'Tokyo', pinColor: color, addressDetails: { city: 'Tokyo' } };
  const result = await ctx.updatePost('post', { body: 'edited', spot });
  assert.deepEqual(payload.spot, spot);
  assert.equal(result.spot.pinColor, color);
}
await ctx.updatePost('post', { body: 'body only' });
assert.equal(Object.hasOwn(payload, 'spot'), false, 'unrelated edits preserve the location');
await ctx.updatePost('post', { spot: null });
assert.equal(payload.spot, null);
console.log('PASS edited pin colors reach database, location metadata survives, unrelated edits preserve spot');

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<main id="app"></main>');
  await page.addScriptTag({ content: fs.readFileSync('src/js/post-edit-state.js', 'utf8').replace(/^export /gm, '') });
  await page.evaluate(() => {
    window.owner = 'alice';
    window.root = document.querySelector('#app');
    window.state = installPostEditState(root, () => owner);
    window.card = () => '<article class="post" data-post-id="p1"><div class="post__body">Original</div></article>';
    root.innerHTML = card();
    const body = root.querySelector('.post__body');
    body.dataset.originalHtml = 'Original';
    body.innerHTML = '<textarea class="post__edit-input">Original</textarea><input value="old"><select><option>public</option><option>only_me</option></select><button style="--pin-color:#123456" data-pin-color-value="#123456">#123456</button>';
    body.querySelector('textarea').value = 'Unsaved\nworking copy';
    body.querySelector('input').value = 'https://github.com/a/b';
    body.querySelector('select').value = 'only_me';
    state.capture();
    root.innerHTML = '<p>Loading detail…</p>';
  });
  await page.evaluate(() => { root.innerHTML = card(); });
  await page.waitForSelector('.post__edit-input');
  assert.equal(await page.inputValue('textarea'), 'Unsaved\nworking copy');
  assert.equal(await page.inputValue('input'), 'https://github.com/a/b');
  assert.equal(await page.inputValue('select'), 'only_me');
  assert.equal(await page.getAttribute('[data-pin-color-value]', 'data-pin-color-value'), '#123456');
  await page.evaluate(() => { state.forget('p1'); root.innerHTML = card(); });
  assert.equal(await page.locator('textarea').count(), 0, 'saved/cancelled edits stay cleared');
  await page.evaluate(() => {
    const body = root.querySelector('.post__body');
    body.innerHTML = '<textarea class="post__edit-input">Alice secret</textarea>';
    state.capture(); owner = 'bob'; state.capture(); root.innerHTML = card();
  });
  assert.equal(await page.locator('textarea').count(), 0, 'account switching drops working copies');
  console.log('PASS timeline → detail retains body/link/audience/color; Save/Cancel and account isolation');
} finally { await browser.close(); }
