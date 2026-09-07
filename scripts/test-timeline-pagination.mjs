import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
let rows=Array.from({length:105},(_,i)=>({id:String(105-i).padStart(5,'0'),author_id:'me',created_at:'2026-09-07T00:00:00.123456+00:00',body:'post',visibility:'public'}));
let queries=[];
const ctx=vm.createContext({console,localStorage:{getItem:()=>null},read:(_,fallback)=>fallback,KEYS:{},
 refreshGithubMembershipsIfNeeded:async()=>{},currentUser:()=>({id:'me'}),
 getClient:async()=>({from:()=>{
  let filter=null,ordering=[];
  const q={select:cols=>{assert(cols.includes('visibility'));return q;},order:(column)=>{ordering.push(column);return q;},
   or:value=>{filter=value;return q;},limit:async limit=>{
    queries.push({filter,ordering});
    const cutoff=filter?.match(/id.lt.([^)]*)/)[1];
    return {data:rows.filter(r=>!cutoff||r.id<cutoff).slice(0,limit)};
   }};return q;
 }})
});
vm.runInContext(fs.readFileSync('src/js/data.js','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),ctx);
ctx.mergeOptimistic=posts=>posts;ctx.savePostsCache=()=>{};
let page=await ctx.forYouPage();const ids=page.posts.map(p=>p.id);
assert.equal(ids.length,40);assert(page.hasMore);
rows.unshift({...rows[0],id:'99999'}); // an insert between pages must not shift older results
while(page.hasMore){page=await ctx.forYouPage({before:page.cursor});ids.push(...page.posts.map(p=>p.id));}
assert.equal(ids.length,105);assert.equal(new Set(ids).size,105);assert(!ids.includes('99999'));
assert(queries.every(q=>q.ordering.join(',')==='created_at,id'));
assert(queries[1].filter.includes('2026-09-07T00:00:00.123456+00:00'));
console.log('PASS >40 posts, exact timestamp cursors, tied timestamps, stable inserts, unique pages, end-of-feed, audience columns');
