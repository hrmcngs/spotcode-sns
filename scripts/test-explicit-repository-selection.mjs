import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const storage=new Map();let owner='a';const rows=[];
const ctx=vm.createContext({currentUser:()=>owner?{id:owner}:null,
 localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
 supaModule:{getClient:async()=>({from:()=>({upsert:async row=>{rows.push(row);return {};}})})},
});
vm.runInContext(fs.readFileSync('src/js/display-prefs.js','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'').replaceAll("import('./supa.js')",'Promise.resolve(supaModule)'),ctx);
assert.equal(ctx.selectedTaskRepos().length,0);
ctx.setTaskRepoVisible('Owner/Repo',true);
ctx.setTaskRepoVisible('Owner/Second',true);
ctx.setTaskRepoVisible('Owner/Repo',false);
await vm.runInContext('preferenceWrites',ctx);
assert.deepEqual(Array.from(rows.at(-1).selected_repos),['owner/second']);
assert(!ctx.selectedTaskRepos().includes('owner/new-repository'));
owner='b';assert.equal(ctx.selectedTaskRepos().length,0);
ctx.setTaskRepoVisible('other/repo',true);await vm.runInContext('preferenceWrites',ctx);
owner='a';assert.deepEqual(Array.from(ctx.selectedTaskRepos()),['owner/second']);
owner=null;assert.equal(ctx.selectedTaskRepos().length,0);
console.log('PASS unchecked by default, explicit selection/removal, new repos stay unchecked, ordered saving and account isolation');
