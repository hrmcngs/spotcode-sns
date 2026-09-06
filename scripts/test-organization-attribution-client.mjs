import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const script = path => fs.readFileSync(path, 'utf8').replace(/^import .*;\n/gm, '').replace(/^export \{.*;\n/gm, '').replace(/^export /gm, '');
let stored;
const context = vm.createContext({
 refreshGithubMembershipsIfNeeded: async () => {}, canReadGithubOrganization: () => false, console, isDevMode: () => false, localStorage: {getItem: () => null, setItem() {}},
 KEYS: {users: 'users'}, read: (_, fallback) => fallback, write() {},
 currentUser: () => ({id: 'me', handle: 'me'}), isPostingAsOfficial: () => false,
 getClient: async () => ({from: () => ({
  insert(row) { stored = {id: 'post', ...row}; return {select: () => ({single: async () => ({data: stored})})}; },
  update(patch) { stored = {...stored, ...patch}; return {eq: () => ({select: async () => ({data: [stored]})})}; },
 })}),
});
vm.runInContext(script('src/js/data.js'), context);
const renderer = vm.createContext({
 getUser: handle => ({handle, name: handle === 'org' ? 'Organization' : 'Me'}), currentUser: () => ({id:'me', handle:'me'}),
 canDisplayCachedPost: p => context.canDisplayCachedPost(p),
 url: s => s, icon: () => '', isLiked: () => false, likeCount: () => 0,
 isReposted: () => false, isBookmarked: () => false, isDevMode: () => false,
 maskName: (_, name) => name, maskHandle: h => h, maskMentionsInText: s => s,
 renderAvatar: () => '', t: s => s, relTime: () => '', renderMarkdown: s => s,
 parseConnpassUrl: () => null, statusBadge: () => '', safeLinkUrl: () => null,
});
vm.runInContext(script('src/js/post.js'), renderer);
context.currentUser = () => ({id:'me',handle:'me'});
context.row = {id:'organization-post',author_id:'me', organization_author_id:'org', body:'Contribution', visibility:'only_me',author:{handle:'me',name:'Member'},organization_author:{handle:'org',name:'Organization'}};
context.setTimeout = () => 1;
const attributed = vm.runInContext('shapePost(row)', context);
assert.equal(attributed.authorId, 'me');
assert.equal(attributed.authorHandle, 'org');
assert.equal(attributed.organizationAuthorId, 'org');
renderer.post = attributed;
assert(vm.runInContext('renderPost(post)', renderer).includes('act--edit'));
assert(vm.runInContext('renderPost(post)', renderer).includes('Organization'));
assert(vm.runInContext('renderPost(post)', renderer).includes('/org'));
renderer.currentUser = () => ({id:'org',handle:'org'});
renderer.post = {...attributed,visibility:'public'};
renderer.isOperator = () => false;
assert(!vm.runInContext('renderPost(post)', renderer).includes('act--edit'));
console.log('PASS organization display identity retains actual author and edit permission');

await vm.runInContext("addPost({body:'Repo contribution',repoFullName:'org/repo'})", context);
assert.equal(stored.repo_full_name, 'org/repo');
console.log('PASS repository field survives post creation');

let requiredRefresh = false;
context.currentUser = () => ({id:'me',handle:'me',github:{handle:'member'}});
context.refreshGithubMembershipsIfNeeded = async options => { requiredRefresh ||= !!options?.required; };
await vm.runInContext("addPost({body:'Contribution',githubLink:'https://github.com/org/repo'})",context);
assert(requiredRefresh);
context.refreshGithubMembershipsIfNeeded = async () => { throw new Error('membership unavailable'); };
await assert.rejects(vm.runInContext("addPost({body:'Contribution',githubLink:'https://github.com/org/repo'})",context),/membership unavailable/);
console.log('PASS GitHub-linked member writes require successful membership verification');
