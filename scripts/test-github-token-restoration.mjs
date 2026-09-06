import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const strip = file => fs.readFileSync(file,'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
let user='a',shared='new-grant',local='old-grant',fresh='old-session-grant',writes=0,switchDuringRead=false;
const ctx=vm.createContext({
  getClient:async()=>({auth:{getSession:async()=>({data:{session:user?{user:{id:user},provider_token:fresh}:null}})},
    rpc:async(name)=>{if(name==='get_github_private_issue_token'){if(switchDuringRead)user='b';return {data:shared};}writes++;return {};}}),
  tokenModule:{restoreGithubApiToken:()=>local,setGithubApiToken:(token)=>{local=token;}},
});
vm.runInContext(strip('src/js/github-oauth.js').replaceAll("import('./language-stats.js')",'Promise.resolve(tokenModule)'),ctx);
assert.equal(await ctx.getGithubToken(),'new-grant');assert.equal(writes,0);assert.equal(local,'new-grant');
fresh=null;assert.equal(await ctx.getGithubToken(),'new-grant');assert.equal(writes,0);
shared=null;assert.equal(await ctx.getGithubToken(),'new-grant');assert.equal(writes,0);
local=null;fresh='first-grant';assert.equal(await ctx.getGithubToken(),'first-grant');assert.equal(writes,1);
shared='other-device';switchDuringRead=true;assert.equal(await ctx.getGithubToken(),null);
user=null;assert.equal(await ctx.getGithubToken(),null);
console.log('PASS shared grant wins over old device/session, refresh omission, fallback, initial capture, account switch and logout');
const storage=new Map();let finish;
const language=vm.createContext({read:(_,fallback)=>fallback,write(){},AbortController,setTimeout,clearTimeout,
 window:{sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}},
 fetch:()=>new Promise(resolve=>{finish=resolve;}),
});
vm.runInContext(strip('src/js/language-stats.js'),language);
language.setGithubApiToken('old','a');
const pending=language.fetchJson('https://api.github.com/user');
language.setGithubApiToken('new','a');
finish({status:401,ok:false});await assert.rejects(pending,/HTTP_401/);
assert.equal(language.restoreGithubApiToken('a'),'new');
assert.equal(language.restoreGithubApiToken('b'),null);assert.equal(language.hasGithubApiToken(),false);
console.log('PASS late 401 cannot erase renewed token; account mismatch clears active credential');
