// Execute only within the required security-review sandbox.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const settings = fs.readFileSync('src/js/views/settings.js', 'utf8');
const auth = fs.readFileSync('src/js/auth.js', 'utf8');
const helpers = settings.slice(settings.indexOf('const audienceState ='), settings.indexOf('const hydratedTaskSettings'));
const patchCode = auth.slice(auth.indexOf('  if (patch.closeFriends != null)'), auth.indexOf('  if (patch.organization != null)'));
const ctx = vm.createContext({});
vm.runInContext(helpers + '\nfunction patchFor(profile, kind) { seedAudience(profile, kind); if (!audienceReady[kind]) throw new Error("Missing stable IDs"); return { [audienceIdFields[kind]]: audienceState[kind].map(entry => entry.id) }; }\nfunction dbPatch(patch) { const db = {}; ' + patchCode + '; return db; }', ctx);
const original = '11111111-1111-4111-8111-111111111111';
const recycled = '22222222-2222-4222-8222-222222222222';
for (const [kind, field, column] of [
  ['closeFriends', 'closeFriendIds', 'close_friend_ids'],
  ['orgMembers', 'orgMemberIds', 'org_member_ids'],
]) {
  // Reusing or renaming a display handle never changes a retained identity.
  for (const label of ['alice', 'renamed-alice', 'alice']) {
    const patch = ctx.patchFor({ [kind]: [label], [field]: [original] }, kind);
    assert.deepEqual(JSON.parse(JSON.stringify(ctx.dbPatch(patch))), { [column]: [original] });
  }
  assert.throws(() => ctx.patchFor({ [kind]: ['alice'] }, kind), /Missing stable IDs/);
  assert.throws(() => ctx.patchFor({ [kind]: ['alice'], [field]: null }, kind), /Missing stable IDs/);
  assert.throws(() => ctx.dbPatch({ [kind]: ['alice'] }), /stable account IDs/);
  assert.throws(() => ctx.dbPatch({ [field]: ['alice'] }), /Invalid audience/);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.dbPatch({ [field]: [original, original, recycled] }))), { [column]: [original, recycled] });
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.dbPatch({ [field]: [] }))), { [column]: [] });
}
const routeCode = auth.slice(auth.indexOf('  const audienceFields ='), auth.indexOf('  let targetId = cachedUser.id;', auth.indexOf('  const audienceFields =')));
vm.runInContext('function routesToOfficial(patch) { let postingAsOfficial = true; ' + routeCode + '; return postingAsOfficial; }', ctx);
assert.equal(ctx.routesToOfficial({ closeFriendIds: [original] }), false);
assert.equal(ctx.routesToOfficial({ orgMemberIds: [] }), false);
assert.equal(ctx.routesToOfficial({ name: 'Official name' }), true);
console.log('PASS audience settings preserve stable IDs through retries, reject legacy lists, and validate UUID writes');
