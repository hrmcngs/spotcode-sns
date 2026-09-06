import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = fs.readFileSync('src/js/data.js','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
function context() {
  const ctx = vm.createContext({console,localStorage:{getItem:()=>null,setItem(){}},
    refreshGithubMembershipsIfNeeded:async()=>{},KEYS:{},read:(_,fallback)=>fallback});
  vm.runInContext(source,ctx);
  return ctx;
}
for (const error of [
  {code:'PGRST200',message:"Could not find a relationship between 'posts' and 'profiles' in the schema cache",details:'Searched using posts_organization_author_id_fkey'},
  {code:'42703',message:'column posts.organization_author_id does not exist'},
  {code:'PGRST204',message:"Could not find the 'organization_author_id' column in the schema cache"},
]) {
  const ctx=context();const calls=[];
  ctx.build=async cols=>{calls.push(cols);return calls.length===1?{error}:{data:[{id:'post'}]};};
  const result=await vm.runInContext('withResilientCols(build)',ctx);
  assert.equal(result.data[0].id,'post');assert.equal(calls.length,2);
  assert(!calls[1].includes('organization_author'));
  assert(calls[1].includes('posts_author_id_fkey'));assert(calls[1].includes('visibility'));
  assert(calls[1].includes('github_org_id'));assert(calls[1].includes('photos'));
}
const ctx=context();let calls=0;
ctx.build=async()=>{calls++;return {error:{code:'42501',message:'permission denied'}};};
assert((await vm.runInContext('withResilientCols(build)',ctx)).error);assert.equal(calls,1);
ctx.build=async()=>{calls++;return {error:{code:'PGRST200',message:"Could not find a relationship between 'posts' and 'profiles' in the schema cache"}};};
calls=0;assert((await vm.runInContext('withResilientCols(build)',ctx)).error);assert.equal(calls,2);
assert(vm.runInContext('postCols()',context()).includes('organization_author'));
console.log('PASS missing relationship/column fallback, preserved audience/photos, bounded retries, permission errors, fresh-page recovery');
