import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
let refreshed=0;
const calls=[];
const ctx=vm.createContext({
 currentUser:()=>({id:'org-account',isOrg:true}),
 getGithubToken:async()=>{throw new Error('File approval must not require OAuth');},
 refreshProfile:async()=>{refreshed++;},
 getClient:async()=>({functions:{invoke:async(name,options)=>{
  calls.push(options.body);
  return {data:options.body.action==='issue_file'?{content:'challenge'}:{organizations:[{id:20}],linked:{org_id:20,login:'Drowse-Lab'}}};
 }}}),
});
vm.runInContext(fs.readFileSync('src/js/github-organizations.js','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),ctx);
assert.equal((await ctx.syncGithubOrganizations({action:'issue_file',organization_login:'Drowse-Lab'})).content,'challenge');
assert.equal(refreshed,0);
await ctx.syncGithubOrganizations({action:'confirm_file'});
assert.equal(refreshed,1);
assert.equal(ctx.canReadGithubOrganization(20),true);
assert.equal(calls[0].github_token,null);
console.log('PASS file flow works without OAuth, issue does not mark verified, confirmation refreshes profile and membership');
