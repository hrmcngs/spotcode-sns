import { createTestI18n } from './helpers/i18n.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const calls = [];
let response = { data: null };
let user = { id: 'me', handle: 'me' };
const db = { from(table) {
  calls.push(['from', table]);
  const query = {};
  for (const method of ['select','eq','maybeSingle','single','upsert','delete','order']) {
    query[method] = (...args) => { calls.push([method, ...args]); return query; };
  }
  query.then = (resolve, reject) => Promise.resolve(response).then(resolve, reject);
  return query;
} };
const source = fs.readFileSync('src/js/business-cards.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const ctx = vm.createContext({ ...createTestI18n(),  getClient: async () => db, currentUser: () => user, URL, console });
vm.runInContext(source, ctx);
const run = code => vm.runInContext(code, ctx);
assert.equal(run("normalizeCard({theme: '__proto__', layout: 'bad'}).theme"), 'midnight');
assert.equal(run("normalizeCard({name:' x ',bio:'x'.repeat(300)}).bio.length"), 280);
assert.equal(run("cardLink('a b')"), 'https://hrmcngs.github.io/spotcode-sns/#/a%20b/card');
await run("saveCard({name:'  Test  ',owner_id:'someone-else',theme:'paper'})");
assert.equal(calls.find(c => c[0] === 'upsert')[1].owner_id, 'me');
assert.equal(calls.find(c => c[0] === 'upsert')[1].name, 'Test');
await assert.rejects(run("saveCard({name:' '})"), /名前/);
await assert.rejects(run("collectCard('me')"), /自分/);
calls.length = 0;
await run("collectCard('other')");
const upsert = calls.find(c => c[0] === 'upsert');
assert.equal(upsert[1].collector_id, 'me');
assert.equal(upsert[2].ignoreDuplicates, true);
calls.length = 0;
await run("removeCard('other')");
assert(calls.some(c => c[0] === 'eq' && c[1] === 'collector_id' && c[2] === 'me'));
calls.length = 0;
await run('unpublishCard()');
assert(calls.some(c => c[0] === 'eq' && c[1] === 'owner_id' && c[2] === 'me'));
response = { error: { message: 'denied' } };
await assert.rejects(run("collectCard('other')"), /再試行/);
user = null;
for (const expression of ["saveCard({name:'test'})", "collectCard('other')", "removeCard('other')", 'loadCollection()', 'unpublishCard()']) {
  await assert.rejects(run(expression), /ログイン/);
}
const view = fs.readFileSync('src/js/views/business-card.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const cardEvents = {};
ctx.document = { addEventListener(type, handler) { cardEvents[type] = handler; } };
vm.runInContext(view, ctx);
const markup = run(`cardMarkup({name:'<img src=x onerror=alert(1)>',theme:'bad',contact:'" onclick="bad'}, '<script>')`);
assert(!markup.includes('<img'));
assert(!markup.includes('<script>'));
assert(markup.includes('business-card--midnight'));
assert(markup.includes('&lt;img'));
assert(markup.includes('aria-pressed="false"'));
console.log('PASS card validation, authenticated ownership, duplicate-safe collection, scoped deletion, errors, escaping, share URL');
// Design loaded from old rows, malicious CSS and out-of-range persisted values.
assert.equal(run("normalizeCard({name:'old'}).design.nameSize"), 26);
assert.equal(run("normalizeCard({theme:'paper',design:{}}).design.frontColor"), '#fffdf4');
assert.equal(run("normalizeCard({design:{frontColor:'red;position:fixed',nameSize:900,radius:-8,font:'evil',frontAlign:'right'}}).design.nameSize"), 36);
assert.equal(run("normalizeCard({design:{radius:-8}}).design.radius"), 0);
assert.equal(run("normalizeCard({design:{frontColor:'red;position:fixed'}}).design.frontColor"), '#222e49');
assert.equal(run("normalizeCard({design_nameSize:'32',design_frontAlign:'right'}).design.nameSize"), 32);
assert.equal(run("normalizeCard({design:{frontLabel:''}}).design.frontLabel"), '');
const detailed = run("cardMarkup({name:'Test',design:{frontLabel:'<script>',nameSize:32,frontAlign:'right',font:'mono'}}, 'me')");
assert(detailed.includes('--card-name-size:32px'));
assert(detailed.includes('business-card__align-right'));
assert(detailed.includes('business-card--font-mono'));
assert(detailed.includes('&lt;script&gt;'));
assert(run("editor(normalizeCard({name:'Old row'}),true)").includes('design_frontColor'));
console.log('PASS legacy design defaults, form conversion, design bounds, CSS allowlists, custom labels and typography');
assert.equal(run("cardWebURL('javascript:alert(1)')"), '');
assert.equal(run("cardWebURL('https://user:password@example.com')"), '');
assert.equal(run("cardImageURL('data:image/svg+xml;base64,PHN2Zz4=')"), '');
assert.equal(run("cardImageURL('data:image/png;base64,aGVsbG8=')"), 'data:image/png;base64,aGVsbG8=');
assert.equal(run("normalizeCard({image_size:900,links:[{url:'javascript:alert(1)'},{label:'Site',url:'https://example.com'}]}).links.length"), 1);
assert.equal(run("normalizeCard({image_size:900}).image_size"), 100);
assert.equal(run("normalizeCard({link_0_label:'Portfolio',link_0_url:'https://example.com'}).links[0].label"), 'Portfolio');
const media = run("cardMarkup({name:'Test',image_url:'https://example.com/image.png',image_link:'https://example.com',links:[{label:'Portfolio',url:'https://example.com'}]},'me')");
assert(media.includes('<img'));
assert(media.includes('business-card__image-link'));
assert(media.includes('Portfolio ↗'));
assert(!/<button[^>]*>[\s\S]*?<a[\s\S]*?<\/button>/.test(media.replace(/<button[^>]*>[^<]*<\/button>/g,'')));
assert(media.includes('inert'));
user = { id: 'me', handle: 'me' };
await assert.rejects(run("saveCard({name:'Test',links:[{url:'javascript:alert(1)'}]})"), /http/);
await assert.rejects(run("saveCard({name:'Test',image_url:'data:text/html,bad'})"), /画像/);
console.log('PASS media and links, HTTP scheme validation, unsafe image rejection, image bounds, form links, separate link/flip controls');
assert.equal(run("normalizeCard({links:[{url:'https://example.com'}]}).links_side"), 'front');
const frontMedia = run("cardMarkup({name:'Front',image_url:'https://example.com/photo.png',links:[{label:'FRONT_LINK',url:'https://example.com'}]},'me')");
assert(frontMedia.indexOf('FRONT_LINK') < frontMedia.indexOf('business-card__back'));
assert(frontMedia.indexOf('<img') < frontMedia.indexOf('business-card__back'));
const backMedia = run("cardMarkup({name:'Back',links_side:'back',links:[{label:'BACK_LINK',url:'https://example.com'}]},'me')");
assert(backMedia.indexOf('BACK_LINK') > backMedia.indexOf('business-card__back'));
console.log('PASS images and links directly on card front by default, optional back placement');
assert.equal(run("paletteFromBase('#FFFFFF').frontColor"), '#ffffff');
assert.equal(run("paletteFromBase('#ffffff').textColor"), '#000000');
assert.equal(run("paletteFromBase('#18181b').textColor"), '#ffffff');
assert.equal(run("paletteFromBase('bad;position:fixed').frontColor"), '#18181b');
assert.equal(run("normalizeCard({design:paletteFromBase('#1d4ed8')}).design.frontColor"), '#1d4ed8');
assert.equal(run("baseColorEditor(normalizeCard({}).design).match(/data-base-chip=/g).length"), 12);
console.log('PASS base-color palette, contrasting text, safe color fallback, persistence and 12 selectable chips');
assert.equal(run("paletteFromBase('#1d4ed8', 'solid').backColor"), '#1d4ed8');
assert.equal(run("normalizeCard({theme:'solid',design:{pattern:'solid',...paletteFromBase('#1d4ed8','solid')}}).design.pattern"), 'solid');
assert.equal(run("normalizeCard({theme:'aurora',design:{...defaultDesign('aurora'),pattern:'stripe',...paletteFromBase('#15803d')}}).theme"), 'aurora');
assert.equal(run("normalizeCard({theme:'aurora',design:{pattern:'stripe',...paletteFromBase('#15803d')}}).design.pattern"), 'stripe');
console.log('PASS solid palette persistence, base-color changes retain theme and pattern');
assert.equal(run("normalizeCard({design:{orientation:'portrait',cornerStyle:'diagonal'}}).design.cornerStyle"), 'diagonal');
assert.equal(run("normalizeCard({design:{orientation:'portrait',cornerStyle:'diagonal'}}).design.orientation"), 'portrait');
assert.equal(run("normalizeCard({design:{orientation:'bad',cornerStyle:'bad'}}).design.cornerStyle"), 'rounded');
assert(run("cardMarkup({name:'Vertical',design:{orientation:'portrait',cornerStyle:'diagonalReverse'}},'me')").includes('business-card--portrait business-card--corners-diagonalReverse'));
console.log('PASS orientation and diagonal corners, defaults and rendered classes');
assert.equal(run("normalizeCard({design:{imagePlacement:'artwork'}}).design.imagePlacement"), 'artwork');
assert.equal(run("normalizeCard({design:{imagePlacement:'bad'}}).design.imagePlacement"), 'inline');
const artwork = run("cardMarkup({name:'Scan',image_url:'https://example.com/card.jpg',image_side:'back',design:{imagePlacement:'artwork'}},'me')");
assert.equal((artwork.match(/class=\"business-card__artwork\"/g) || []).length, 1);
assert(artwork.indexOf('class="business-card__artwork"') > artwork.indexOf('business-card__back'));
assert(run("editor(normalizeCard({name:'Template'}),false)").includes('data-card-template'));
console.log('PASS artwork mode persistence, selected face, and template download control');
for (const base of ['#000000', '#ffffff', '#1d4ed8', '#15803d']) {
  const palette = run(`paletteFromBase('${base}', 'gradient', 'aurora')`);
  assert.notEqual(palette.frontColor, palette.backColor);
  assert.notEqual(palette.backColor, run(`paletteFromBase('${base}', 'gradient', 'midnight').backColor`));
  assert.equal(run(`paletteFromBase('${base}', 'solid', 'aurora').backColor`), base);
}
console.log('PASS aurora keeps distinct gradient colors, solid remains solid');
response = {data: null};
for (const theme of ['mono','ghost','spring','summer','autumn','winter']) {
  calls.length = 0;
  await run(`saveCard({name:'Season',theme:'${theme}'})`);
  const stored = calls.find(c => c[0] === 'upsert')[1];
  assert.equal(stored.theme, 'midnight');
  assert.equal(stored.design.themeVariant, theme);
  assert.equal(run(`normalizeCard(${JSON.stringify(stored)}).theme`), theme);
  assert(run(`cardMarkup(${JSON.stringify(stored)},'me')`).includes('business-card--' + theme));
}
assert.equal(run("defaultDesign('mono').font"), 'mono');
console.log('PASS six themes, legacy-compatible storage and reload, theme classes and mono font');
let turns = 0;
const gestureCard = {classList:{toggle(){turns++;return turns%2===1;}},querySelectorAll(){return [];}};
const target = {closest(selector){return selector === '.business-card' ? gestureCard : null;}};
cardEvents.wheel({target,deltaX:0,deltaY:100,preventDefault(){throw Error('Vertical scroll blocked');}});
assert.equal(turns,0);
cardEvents.wheel({target,deltaX:80,deltaY:0,preventDefault(){}});
cardEvents.wheel({target,deltaX:80,deltaY:0,preventDefault(){}});
assert.equal(turns,1);
cardEvents.pointerdown({target,clientX:0,clientY:0});
cardEvents.pointerup({target,clientX:90,clientY:5});
assert.equal(turns,2);
cardEvents.click({target,preventDefault(){}});
assert.equal(turns,2);
assert(!run("cardMarkup({name:'No hint'},'me')").includes('タップして'));
console.log('PASS horizontal wheel, momentum debounce, swipe, click suppression and no printed hint');

// Returning to a visible card refreshes once, even when focus and visibility fire together.
let finishRefresh;
ctx.refreshCalls = 0;
ctx.finishRefresh = resolve => { finishRefresh = resolve; };
run('refreshVisibleCard = () => { refreshCalls++; return new Promise(finishRefresh); }');
ctx.document.visibilityState = 'hidden';
await cardEvents.visibilitychange();
assert.equal(ctx.refreshCalls, 0);
ctx.document.visibilityState = 'visible';
const refreshPending = cardEvents.visibilitychange();
await cardEvents.visibilitychange();
assert.equal(ctx.refreshCalls, 1);
finishRefresh();
await refreshPending;
run('refreshVisibleCard = null');
await cardEvents.visibilitychange();
assert.equal(ctx.refreshCalls, 1);
console.log('PASS card foreground refresh, hidden-page suppression and duplicate-event coalescing');

// An edit started while a refresh is in flight must keep its form and preview.
let completeLoad;
ctx.completeLoad = resolve => { completeLoad = resolve; };
const previousLoad = run('loadCard');
run('loadCard = () => new Promise(completeLoad)');
const unchangedContent = { innerHTML: 'unsaved draft' };
ctx.document.querySelector = () => ({
  isConnected: true,
  querySelector: selector => selector === '[data-card-content]' ? unchangedContent : {}
});
ctx.allowRefresh = true;
const editingRace = run("hydrateBusinessCard('me', false, () => allowRefresh)");
ctx.allowRefresh = false;
completeLoad({ profile: { id: 'me' }, card: { name: 'remote change' } });
await editingRace;
assert.equal(unchangedContent.innerHTML, 'unsaved draft');
ctx.previousLoad = previousLoad;
run('loadCard = previousLoad');
console.log('PASS refresh response does not replace an edit started during loading');

// Every imported preset must survive the legacy SQL theme constraint and reload.
user = { id: 'me', handle: 'me' };
response = { data: null };
const readmeThemes = JSON.parse(fs.readFileSync('src/data/readme-themes.json', 'utf8'));
for (const name of Object.keys(readmeThemes)) {
  const key = 'readme-' + name;
  calls.length = 0;
  await run(`saveCard({name:'Theme test',theme:${JSON.stringify(key)}})`);
  const saved = calls.find(c => c[0] === 'upsert')[1];
  assert.equal(saved.theme, 'midnight');
  assert.equal(saved.design.themeVariant, key);
  const restored = run(`normalizeCard(${JSON.stringify(saved)})`);
  assert.equal(restored.theme, key);
  for (const field of ['frontColor','backColor','textColor','accentColor']) {
    assert.match(restored.design[field], /^#[0-9a-f]{6}$/);
    assert.equal(restored.design[field], run(`defaultDesign(${JSON.stringify(key)}).${field}`));
  }
}
assert.equal(run("defaultDesign('readme-dracula').frontColor"), '#282a36');
assert.equal(run("defaultDesign('readme-highcontrast').frontColor"), '#000000');
assert.equal(run("defaultDesign('readme-ambient_gradient').backColor"), '#ffcc70');
console.log(`PASS all ${Object.keys(readmeThemes).length} Readme themes save and reload with valid card colors`);
