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
const ctx = vm.createContext({ getClient: async () => db, currentUser: () => user, URL, console });
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
ctx.document = { addEventListener() {} };
vm.runInContext(view, ctx);
const markup = run(`cardMarkup({name:'<img src=x onerror=alert(1)>',theme:'bad',contact:'" onclick="bad'}, '<script>')`);
assert(!markup.includes('<img'));
assert(!markup.includes('<script>'));
assert(markup.includes('business-card--midnight'));
assert(markup.includes('&lt;img'));
assert(markup.includes('aria-pressed="false"'));
console.log('PASS card validation, authenticated ownership, duplicate-safe collection, scoped deletion, errors, escaping, share URL');
