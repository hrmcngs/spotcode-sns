import fs from 'node:fs';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH, headless:true});
try {
 const page = await browser.newPage({viewport:{width:900,height:1200},hasTouch:true});
 const errors=[]; page.on('pageerror', error=>errors.push(error.message));
 await page.setContent('<style>body{padding:24px;background:#0b1017;color:white}form{width:500px}</style><form class="card-editor"><div id="editor"></div></form>');
 await page.addStyleTag({content:fs.readFileSync('src/css/style.css','utf8')});
 await page.addScriptTag({content:'const t = (key, values={}) => Object.entries(values).reduce((s,[k,v])=>s.replace("{"+k+"}",v),key); const getLocale=()=>"en"; const currentUser=()=>({id:"me"}); const url=x=>x;'});
 for(const file of ['src/js/business-cards.js','src/js/views/business-card.js'])
  await page.addScriptTag({content:fs.readFileSync(file,'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'')});
 await page.evaluate(()=>{
  window.card=normalizeCard({name:'Hiromichi',title:'Developer',bio:'Build something useful',contact:'hello@example.test'});
  bindLayerEditor(document.querySelector('#editor'),()=>window.card,layers=>{window.card={...window.card,design:{...window.card.design,layers}};});
 });
 assert.equal(await page.locator('[data-layer-stage]').count(),1);
 const layer=page.locator('[data-layer-stage] [data-card-layer="name"]');
 const box=await layer.boundingBox(); assert(box.width>100 && box.height>20);
 const start=await page.evaluate(()=>(window.card.design.layers ?? defaultCardLayers(window.card)).find(l=>l.kind==='name').x);
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2); await page.mouse.down();
 await page.mouse.move(box.x+box.width/2+30,box.y+box.height/2+10,{steps:5}); await page.mouse.up();
 const moved=await page.evaluate(()=>(window.card.design.layers ?? defaultCardLayers(window.card)).find(l=>l.kind==='name').x); assert(moved>start);
 await page.locator('[data-layer-undo]').click();
 assert.equal(await page.evaluate(()=>(window.card.design.layers ?? defaultCardLayers(window.card)).find(l=>l.kind==='name').x),start);
 await page.locator('[data-layer-redo]').click();
 assert.equal(await page.evaluate(()=>(window.card.design.layers ?? defaultCardLayers(window.card)).find(l=>l.kind==='name').x),moved);
 // A finger drag must also move the text without flipping the card.
 await layer.scrollIntoViewIfNeeded();
 const touchBox = await layer.boundingBox();
 const cdp = await page.context().newCDPSession(page);
 const finger = {x:touchBox.x+20,y:touchBox.y+10};
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[finger]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:finger.x+40,y:finger.y+20}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert((await page.evaluate(()=>window.card.design.layers.find(l=>l.kind==='name').x))>moved);
 await cdp.detach();
 await page.locator('[data-layer-number="rotation"]').fill('25'); await page.locator('[data-layer-number="rotation"]').press('Tab');
 assert.equal(await page.evaluate(()=>window.card.design.layers.find(l=>l.kind==='name').rotation),25);
 await page.locator('[data-layer-locked]').check(); assert(await page.locator('[data-layer-number="x"]').isDisabled());
 await page.locator('[data-layer-hidden]').check();
 const rendered=await page.evaluate(()=>cardMarkup(normalizeCard(JSON.parse(JSON.stringify(window.card))),''));
 assert(!rendered.includes('data-card-layer="name"'));
 await page.locator('[data-layer-hidden]').uncheck(); await page.locator('[data-layer-locked]').uncheck();
 await page.locator('[data-layer-front]').click();
 assert.equal(await page.evaluate(()=>window.card.design.layers.at(-1).kind),'name');
 await page.locator('[data-layer-side]').selectOption('back');
 assert.equal(await page.locator('[data-layer-stage] [data-card-layer="name"]').count(),0);
 assert.equal(await page.locator('[data-layer-stage] [data-card-layer="bio"]').count(),1);
 await page.screenshot({path:'/tmp/spotcode-card-layers.png',fullPage:true});
 const normalized=await page.evaluate(()=>normalizeCard({design:{layers:[{kind:'name',x:999,width:999,rotation:-999,fontSize:999},{kind:'name'},{kind:'<script>'}]}}).design.layers);
 assert.equal(normalized.length,1); assert.equal(normalized[0].x,0); assert.equal(normalized[0].width,100); assert.equal(normalized[0].rotation,-180);
 // Existing oversized link boxes fit one label, and grow for multiple links.
 await page.evaluate(()=>{
  window.card=normalizeCard({...window.card,links:[{label:'website',url:'https://example.com'}],design:{...window.card.design,layers:[{kind:'links',side:'front',x:8,y:8,width:84,height:65,fontSize:14}]}});
  bindLayerEditor(document.querySelector('#editor'),()=>window.card,layers=>{window.card.design.layers=layers;});
 });
 const single=await page.locator('[data-card-layer="links"]').boundingBox();
 assert(single.width<150 && single.height<40,'One short link must not fill its saved large box');
 await page.evaluate(()=>{
  window.card.links.push({label:'second website',url:'https://example.org'});
  bindLayerEditor(document.querySelector('#editor'),()=>window.card,layers=>{window.card.design.layers=layers;});
 });
 const multiple=await page.locator('[data-card-layer="links"]').boundingBox();
 assert(multiple.height>single.height && multiple.width>single.width);
 // Every text field fits content, including Japanese and explicit newlines.
 for (const kind of ['name','title','bio','contact','frontLabel','backLabel']) {
  const bounds = await page.evaluate(kind=>{
   const value={name:'名前',title:'肩書き',bio:'自己紹介',contact:'連絡先',design:{frontLabel:'表',backLabel:'裏',layers:[{kind,side:'front',x:8,y:8,width:84,height:70,fontSize:14}]}};
   document.querySelector('#editor').innerHTML=cardMarkup(normalizeCard(value),'');
   const el=document.querySelector(`[data-card-layer="${kind}"]`);
   const one=el.getBoundingClientRect();
   el.textContent='日本語の文章\n二行目';
   const two=el.getBoundingClientRect();
   return {width:one.width,height:one.height,multiline:two.height};
  },kind);
  assert(bounds.width<160 && bounds.height<40,kind+' should fit its text');
  assert(bounds.multiline>bounds.height,kind+' should grow for newlines');
 }
 // Exercise the real editor wiring through submit, not just the canvas helper.
 await page.evaluate(async()=>{
  loadCard = async()=>({profile:{id:'me',handle:'me',name:'Owner'},card:normalizeCard({name:'Owner',title:'Designer'})});
  saveCard = async value=>{window.lastSaved=normalizeCard(value);return window.lastSaved;};
  document.body.innerHTML=renderBusinessCard('me');
  await hydrateBusinessCard('me');
 });
 await page.locator('[data-edit-card]').click();
 assert(await page.locator('.card-showcase-wrap').isHidden());
 assert.equal(await page.locator('[data-layer-stage]').count(),1);
 await page.locator('[data-layer-number="rotation"]').fill('35');
 await page.locator('[data-layer-number="rotation"]').press('Tab');
 await page.locator('form.card-editor button[type="submit"]').click();
 await page.waitForFunction(()=>window.lastSaved?.design.layers?.some(l=>l.kind==='name' && l.rotation===35));
 assert.equal(await page.evaluate(()=>window.lastSaved.name),'Owner');
 assert.deepEqual(errors,[]);
 console.log('PASS browser drag, undo/redo, rotation, locking, hidden view, front/back, ordering, JSON persistence and bounds');
} finally { await browser.close(); }
