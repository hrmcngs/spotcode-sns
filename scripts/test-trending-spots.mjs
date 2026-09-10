import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const storage = new Map();
let owner = 'me', requests = 0;
let rows = Array.from({length: 40}, (_,i) => ({id:String(i),author_id:'author',body:'Pin',spot:{lat:35,lng:135,addressDetails:{city:i===39?'京都市':'世田谷区'}}}));
const ctx = vm.createContext({
 refreshGithubMembershipsIfNeeded:async()=>{},
 currentUser:()=>({id:owner}), isHiddenUser:(_,id)=>id==='muted',isDevMode:()=>false,
 localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
 read:(_,fallback)=>fallback,write(){},KEYS:{},console,
 getClient:async()=>({from:()=>{
  const q={select(){return q;},not(){return q;},order(){return q;},limit:async()=>{requests++;return {data:rows};}};
  return q;
 }}),
});
vm.runInContext(fs.readFileSync('src/js/data.js','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),ctx);
let paints=0;ctx.onPostsCacheChange(()=>paints++);
ctx.savePostsCache('home',[{id:'home',spot:{lat:35,lng:135,addressDetails:{city:'大阪市'}}}]);
assert.equal(ctx.trendingCities().length,0); // a stale home cache is not a spot ranking
const first=ctx.postsWithSpots(), second=ctx.postsWithSpots();
await Promise.all([first,second]);
assert.equal(requests,1);
assert.equal(ctx.cachedPosts('spots').length,40); // Kyoto beyond the old 30-row cache limit
assert.equal(ctx.trendingCities().find(c=>c.city==='京都市').count,1);
assert.equal(paints,2);
ctx.savePostsCache('home',[]);
assert.equal(ctx.trendingCities().find(c=>c.city==='京都市').count,1);
ctx.prependToTimelineCaches({id:'new',authorId:'author',spot:{lat:35,lng:135,addressDetails:{city:'京都市'}}});
assert.equal(ctx.trendingCities().find(c=>c.city==='京都市').count,2);
ctx.markPendingDelete('new');
assert.equal(ctx.trendingCities().find(c=>c.city==='京都市').count,1);
ctx.unmarkPendingDelete('new');
assert.equal(ctx.trendingCities().find(c=>c.city==='京都市').count,2);
ctx.removeFromTimelineCaches('new');
assert.equal(ctx.trendingCities().find(c=>c.city==='京都市').count,1);
ctx.savePostsCache('spots',[
 {id:'ok',authorId:'author',spot:{lat:35,lng:135,addressDetails:{city:'京都市'}}},
 {id:'ok',authorId:'author',spot:{lat:35,lng:135,addressDetails:{city:'京都市'}}},
 {id:'invalid',spot:{lat:null,lng:135,addressDetails:{city:'京都市'}}},
 {id:'muted',authorId:'muted',spot:{lat:35,lng:135,addressDetails:{city:'京都市'}}},
 {id:'no-city',spot:{lat:35,lng:135}},
]);
assert.equal(ctx.trendingCities()[0].count,1);
owner='another';
assert.equal(ctx.trendingCities().length,0);
const pending=ctx.postsWithSpots();owner='third';
await assert.rejects(pending,/アカウント/);
console.log('PASS Kyoto beyond home/cache limit, shared map/rail fetch, cache repaint, additions/deletions, duplicate/invalid/muted exclusion and account isolation');
