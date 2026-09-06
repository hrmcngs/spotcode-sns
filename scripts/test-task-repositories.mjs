import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const ctx=vm.createContext({AbortSignal});
vm.runInContext(fs.readFileSync('src/js/task-repositories.js','utf8').replace(/^export /gm,''),ctx);
const requests=[];
const names=await ctx.publicTaskRepositories('hrmcngs',async url=>{
  requests.push(url);
  return {ok:true,json:async()=>requests.length===1
    ? Array.from({length:100},(_,i)=>({full_name:'hrmcngs/repo-'+i}))
    : [{full_name:'hrmcngs/hrmc.ngs.computer'}]};
});
assert(names.includes('hrmcngs/hrmc.ngs.computer'));
assert.equal(requests.length,2);assert(requests[1].includes('page=2'));
await assert.rejects(ctx.publicTaskRepositories('hrmcngs',async()=>({ok:false})),/取得できません/);
console.log('PASS repository without Issues appears, dotted names preserved, pagination and errors');
