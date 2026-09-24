// Execute only inside the security-audit skill's prescribed isolated sandbox.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const stripModules = source => source.replace(/^import\s+[\s\S]*?;\n/gm, '').replace(/^export /gm, '');
let profile;
const ctx = vm.createContext({
  URL, currentUser: () => null, getUser: () => profile,
  isPrivacyMode: () => false, maskInitial: (_, value) => value,
  maskName: (_, value) => value, maskHandle: value => value,
  isPostingAsOfficial: () => false, OFFICIAL_HANDLE: 'official',
  t: value => value, icon: () => '', url: path => '#' + path,
  followerCount: () => 0, followingCount: () => 0,
  cachedLanguageStats: () => null, cachedPosts: () => null,
  cachedContributions: () => null, renderGrass: () => '',
  cachedTasks: () => null, tasksHidden: () => false,
  renderTimelineSkeleton: () => '', quickNavLinks: () => '',
});
vm.runInContext(stripModules(fs.readFileSync('src/js/safe-url.js', 'utf8')), ctx);
vm.runInContext(stripModules(fs.readFileSync('src/js/avatar.js', 'utf8')), ctx);
// Exercise actual rendering functions without registering page event handlers.
const view = fs.readFileSync('src/js/views/profile.js', 'utf8');
vm.runInContext(stripModules(view.slice(0, view.indexOf('// In-flight hydration dedupe.'))), ctx);
const run = expression => vm.runInContext(expression, ctx);

const payload = '<img src=x onerror=alert(1)>';
profile = { id: 'alice-id', handle: 'alice', name: payload, bio: payload, location: payload, joined: payload };
let markup = run("renderProfile('alice')");
assert(!markup.includes('<img'), 'profile text must not become an image element');
assert.equal((markup.match(/&lt;img src=x onerror=alert\(1\)&gt;/g) || []).length, 4);
profile = { handle: 'alice', name: 'Alice & Bob', bio: 'a < b\n日本語', location: 'Tokyo' };
markup = run("renderProfile('alice')");
assert(markup.includes('Alice &amp; Bob'));
assert(markup.includes('a &lt; b\n日本語'));

// Attribute boundaries and rejected link schemes, including linked GitHub fields.
profile.github = { handle: '\"><img src=x onerror=alert(1)>', url: 'javascript:alert(1)' };
markup = run("renderProfile('alice')");
assert(!markup.includes('<img'));
assert(!markup.includes('href="javascript:'));
assert(markup.includes('data-gh="&quot;&gt;&lt;img'));
ctx.attack = payload;
assert(!run('notFound(attack)').includes('<img'));
assert(!run('loading(attack)').includes('<img'));

// CSS quoting alone does not protect the surrounding HTML double quotes.
for (const image of [
  'https://example.test/x\" onmouseover=\"alert(1)',
  'https://example.test/x\"><img src=x onerror=alert(1)>',
  'https://example.test/x\' );color:red;/*',
  'https://example.test/x&quot; onmouseover=&quot;alert(1)',
]) {
  ctx.avatarUser = { handle: 'alice', avatarImage: image };
  const avatar = run('renderAvatar(avatarUser)');
  assert.match(avatar, /^<div class="avatar" style="[^"<>]*"><\/div>$/);
  assert(!avatar.includes('<img'));
}
ctx.avatarUser = { handle: 'alice', avatarImage: 'javascript:alert(1)', avatar: '<' };
assert.equal(run('renderAvatar(avatarUser)'), '<div class="avatar">&lt;</div>');
console.log('PASS profile text, route placeholders, GitHub attributes, avatar CSS/HTML boundaries');
