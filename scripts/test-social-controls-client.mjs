import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const storage = new Map();
let owner = {id:'me',handle:'me'}, rpcError = null, switchDuringLookup = false;
let refreshed = 0;
const writes = [];
const context = vm.createContext({
 currentUser: () => owner,
 refreshProfile: async () => {refreshed++;},
 localStorage: {getItem:key=>storage.get(key) ?? null,setItem:(key,value)=>storage.set(key,value)},
 getClient: async () => ({
  rpc: async (name,args) => {writes.push({name,args});return {error:rpcError};},
  from: table => {
   const query = {
    select(){return query;},eq(){return query;},delete(){writes.push({table,delete:true});return query;},
    upsert(row){writes.push({table,row});return query;},
    single:async()=>{if(switchDuringLookup)owner={id:'other',handle:'other'};return {data:{id:'target-id',handle:'target'}};},
    then(resolve){resolve({data:[],error:null});},
   };return query;
  },
 }),
});
const source = path => fs.readFileSync(path,'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
vm.runInContext(source('src/js/social-controls.js'),context);
await context.setUserControl('target','mutes',true);
assert.equal(context.isUserMuted('target'),true);
assert.equal(context.isHiddenUser(null,'target-id'),true);
owner={id:'other',handle:'other'};
assert.equal(context.isUserMuted('target'),false);
owner={id:'me',handle:'me'};
await context.setUserControl('target','mutes',false);
assert.equal(context.isUserMuted('target'),false);
rpcError={message:'network failed'};
await assert.rejects(context.setUserControl('target','blocks',true));
assert.equal(context.isUserBlocked('target'),false);
rpcError=null;
await context.setUserControl('target','blocks',true);
assert.equal(context.isUserBlocked('target'),true);
await context.setAudienceMember('target','friends',true);
assert.equal(refreshed,1);
assert.equal(writes.at(-1).args.p_kind,'friends');
const count = writes.length;
switchDuringLookup=true;
await assert.rejects(context.setUserControl('target','mutes',true),/アカウント/);
assert.equal(writes.length,count);
switchDuringLookup=false;owner={id:'me',handle:'me'};
vm.runInContext(source('src/js/push-notify.js'),context);
context.setFollowedPostScope('following');
const notice = {type:'followed_post',scope:'following',actor:{handle:'safe'}};
assert.equal(context.filterNotificationTypes([notice]).length,1);
assert.equal(context.filterNotificationTypes([{...notice,actor:{handle:'target'}}]).length,0);
context.setFollowedPostScope('mutuals');
assert.equal(context.filterNotificationTypes([notice]).length,0);
context.setFollowedPostScope('off');
assert.equal(context.filterNotificationTypes([{...notice,scope:'off'}]).length,0);
console.log('PASS persisted per-account mute/block state, failure rollback, account-switch guard, audience RPC and stale-scope/hidden-actor notification filtering');
