import assert from 'node:assert/strict';
import { verifyOrganizationFile, organizationForVerification } from '../supabase/functions/github-organizations/file-verification.ts';
const content = 'spotcode-org-verification:account:unique-token';
let repo = {owner:{id:20,type:'Organization'},fork:false,private:false};
let file = {type:'file',encoding:'base64',size:100,content:btoa(content+'\n')};
const fetcher=async url=>{
 assert.ok(url.startsWith('https://api.github.com/'));
 if(url.includes('/contents/')) { assert.ok(url.endsWith('/contents/spotcode-verification.txt')); return Response.json(file); }
 return Response.json(repo);
};
await verifyOrganizationFile(20,'Drowse-Lab',content,fetcher);
await assert.rejects(verifyOrganizationFile(20,'Drowse-Lab','different-account-code',fetcher),/一致/);
repo.fork=true; await assert.rejects(verifyOrganizationFile(20,'Drowse-Lab',content,fetcher),/Fork/);repo.fork=false;
repo.owner.id=99;await assert.rejects(verifyOrganizationFile(20,'Drowse-Lab',content,fetcher),/所有/);repo.owner.id=20;
file.type='dir';await assert.rejects(verifyOrganizationFile(20,'Drowse-Lab',content,fetcher),/形式/);
await assert.rejects(organizationForVerification('../other',fetcher),/Organization名/);
await assert.rejects(verifyOrganizationFile(20,'Drowse-Lab',content,async()=>new Response('',{status:404})),/取得/);
console.log('PASS file content, account-specific code, fork/owner/path checks, missing file');
