import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
let user={id:'me',github:{handle:'me'}},notices=[],shown=[],publicCalls=0;
const list={isConnected:true,querySelectorAll:()=>[],before:el=>notices.push(el),innerHTML:''};
const ctx=vm.createContext({
 document:{getElementById:()=>list,querySelectorAll:()=>[],createElement:()=>({dataset:{},setAttribute(){}})},
 currentUser:()=>user,currentPath:()=>'/repos',getGithubToken:async()=> 'test-grant',
 syncGithubOrganizations:async()=>{throw new Error('Failed to send a request to the Edge Function');},
 publicRepositories:async()=>{publicCalls++;return [{full_name:'me/hrmc.ngs.computer',name:'hrmc.ngs.computer',fork:true,owner:{login:'me'}}];},
 postsWithGithubRefs:async()=>[],localStorage:{getItem:()=>null,setItem(){}},
 cancelAnimationFrame(){},t:key=>key,
});
vm.runInContext(fs.readFileSync('src/js/views/repos.js','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),ctx);
ctx.schedulePaint=(_,map)=>{shown=[...map.values()];};ctx.paintListNow=(_,rows)=>{shown=rows;};
await ctx.hydrateRepos();await new Promise(resolve=>setImmediate(resolve));
assert.equal(publicCalls,1);assert.equal(shown[0].fullName,'me/hrmc.ngs.computer');assert.equal(notices.length,1);
ctx.syncGithubOrganizations=async()=>({repositories:[{full_name:'org/private',owner:{login:'org'}}]});
await ctx.hydrateRepos();assert.equal(publicCalls,1);assert.equal(shown[0].fullName,'org/private');
ctx.syncGithubOrganizations=async()=>{user={id:'other'};throw new Error('network');};
await ctx.hydrateRepos();assert.equal(publicCalls,1);
console.log('PASS unavailable Edge falls back to public repos including Forks; success keeps org repos; account switch cancels fallback');
