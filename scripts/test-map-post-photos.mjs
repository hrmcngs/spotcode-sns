import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
let near = true, viewer = { handle: 'viewer' }, developer = false;
const context = vm.createContext({
  isNearSpotSync: () => near,
  currentUser: () => viewer,
  isDevMode: () => developer,
  getRadius: () => 100,
  t: key => key,
});
vm.runInContext(read('../src/js/safe-url.js').replace(/^export /gm, ''), context);
const postSource = read('../src/js/post.js');
const mapSource = read('../src/js/views/map.js');
vm.runInContext(postSource.slice(postSource.indexOf('function escape('), postSource.indexOf('// Re-export')), context);
vm.runInContext(postSource.slice(postSource.indexOf('export function renderPostPhotos('), postSource.indexOf('// Poll card.')).replace('export ', ''), context);
vm.runInContext(mapSource.slice(mapSource.indexOf('function pinPopupHtml('), mapSource.indexOf('export async function hydrateMap')), context);

const jpeg = 'data:image/jpeg;base64,/9j/2Q==';
const post = {
  authorHandle: 'author', body: '<hello>', spot: { lat: 35, lng: 139, label: '<school>' },
  photos: [jpeg, 'https://example.com/photo.png'],
};
let html = context.pinPopupHtml(post);
assert.ok(html.includes(jpeg), 'Camera/iOS data URLs must render in map popups');
assert.ok(html.includes('https://example.com/photo.png'));
assert.ok(html.includes('post__photos--2'));
assert.ok(html.includes('&lt;hello&gt;') && html.includes('&lt;school&gt;'));
assert.equal((html.match(/<img /g) || []).length, 2);
assert.ok(context.pinPopupHtml({ ...post, body: '' }).includes(jpeg), 'Photo-only posts must render');
assert.ok(!context.pinPopupHtml({ ...post, photos: undefined }).includes('<img'));
assert.ok(!context.pinPopupHtml({ ...post, photos: [] }).includes('<img'));
for (const location of [false, null]) {
  near = location;
  html = context.pinPopupHtml(post);
  assert.ok(html.includes('map.locked'));
  assert.ok(!html.includes(jpeg) && !html.includes('photo.png') && !html.includes('&lt;hello&gt;'),
    'Locked posts must not embed image URLs or body content');
}
viewer = { handle: 'author' };
assert.ok(context.pinPopupHtml(post).includes(jpeg), 'Authors can see their photos anywhere');
viewer = null;
developer = true;
assert.ok(context.pinPopupHtml(post).includes(jpeg), 'Preserve developer access');
developer = false;
near = true;
html = context.pinPopupHtml({ ...post, photos: ['javascript:alert(1)', 'data:text/html;base64,abc', 'https://example.com/" onerror="alert(1)'] });
assert.equal((html.match(/<img /g) || []).length, 1);
assert.ok(!html.includes('src="javascript:') && !html.includes('src="data:text/html'));
assert.ok(html.includes('&quot; onerror=&quot;'), 'Image attributes must remain escaped');
console.log('PASS map post photos: JPEG/HTTPS, photo-only posts, location gate, author/developer access, URL safety');
