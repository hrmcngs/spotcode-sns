import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const storage=new Map();let oauthOptions,active={user:{id:'spotcode-user'},access_token:'session',refresh_token:'refresh'};
let savedToken=null, savedUnder=null;
const ctx=vm.createContext({URL,URLSearchParams,location:{search:''},window:{location:{href:'https://example.com/index.html#/settings/account'}},
 sessionStorage:{setItem:(key,value)=>storage.set(key,value),getItem:key=>storage.get(key),removeItem:key=>storage.delete(key)},
 tokenModule:{restoreGithubApiToken:()=>null,setGithubApiToken(){}},prefModule:{privateTasksEnabled:()=>false},
 getClient:async()=>({
  auth:{getSession:async()=>({data:{session:active}}),signInWithOAuth:async options=>{oauthOptions=options;return {data:{}};},
   setSession:async tokens=>{active={...tokens,user:{id:'spotcode-user'}};return {};}}
  ,rpc:async(name,args)=>{if(name.startsWith('get_'))return {data:null};savedToken=args.p_token;savedUnder=active.user.id;return {};}
 }),
});
const source=fs.readFileSync('src/js/github-oauth.js','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'')
 .replaceAll("import('./language-stats.js')",'Promise.resolve(tokenModule)').replaceAll("import('./display-prefs.js')",'Promise.resolve(prefModule)');
vm.runInContext(source,ctx);
await ctx.linkGithubForOrganizations();
assert.equal(oauthOptions.options.scopes,'read:user read:org');
const orgReturn=new URL(oauthOptions.options.redirectTo).search;
assert.equal(ctx.githubAuthorizationReturnPath(orgReturn),'/settings/account');
ctx.location.search=orgReturn;active={user:{id:'github-callback'},provider_token:'org-grant'};
assert.equal(await ctx.finishPrivateIssueAuthorization(),true);
assert.equal(savedToken,'org-grant');assert.equal(savedUnder,'spotcode-user');
await ctx.linkGithubForPrivateIssues();
assert.equal(oauthOptions.options.scopes,'read:user read:org repo');
assert.equal(ctx.githubAuthorizationReturnPath(new URL(oauthOptions.options.redirectTo).search),'/settings/display');
assert.equal(ctx.githubAuthorizationReturnPath(''),null);
console.log('PASS Organization requests read:org and returns to account; private Issues requests repo and returns to display; callback restores original account before saving');
