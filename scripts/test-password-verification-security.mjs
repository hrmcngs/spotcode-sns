// Run only inside the prescribed isolated, offline security-audit sandbox.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync('src/js/auth.js', 'utf8');
const start = source.indexOf('export async function verifyCurrentPassword(');
const end = source.indexOf('// Rotate the password', start);
assert(start >= 0 && end > start);
const implementation = source.slice(start, end).replace(/^export /, '');
const actor = { id: 'account-a', email: 'a@example.invalid' };
const activeSession = { user: { id: actor.id }, aal: 'aal2' };
let nextResult;
let beforeResponse;
let config;
let options;
let credentials;
let signout;
let cleanupFails;
let active;
const ctx = vm.createContext({
  crypto: { randomUUID: () => 'dummy-isolated-id' },
  t: value => value,
  translateAuthError: value => value,
  getConfig: () => config,
  getClient: async () => ({ auth: { getSession: async () => ({ data: { session: active } }) } }),
  loadSdk: async () => ({ createClient: (url, key, settings) => {
    assert.equal(url, 'https://dummy.invalid');
    assert.equal(key, 'dummy-anon');
    options = settings;
    return { auth: {
      signInWithPassword: async value => { credentials = value; beforeResponse?.(); return nextResult; },
      signOut: async value => { signout = value; if (cleanupFails) throw new Error('offline cleanup'); },
    } };
  } }),
  // Adopting the temporary AAL1 session must never occur.
  adoptSession: () => { throw new Error('must preserve the active session'); },
});
vm.runInContext('let cachedUser;\n' + implementation, ctx);
function reset() {
  ctx.actor = actor;
  vm.runInContext('cachedUser = actor', ctx);
  active = activeSession;
  nextResult = { data: { session: { user: { id: actor.id }, aal: 'aal1' } } };
  config = { url: 'https://dummy.invalid', anonKey: 'dummy-anon' };
  options = credentials = signout = beforeResponse = null;
  cleanupFails = false;
}
const verify = () => vm.runInContext("verifyCurrentPassword('correct dummy password')", ctx);
reset();
assert.equal(await verify(), true);
assert.equal(active, activeSession);
assert.equal(vm.runInContext('cachedUser.id', ctx), actor.id);
assert.equal(options.auth.persistSession, false);
assert.equal(options.auth.autoRefreshToken, false);
assert.equal(options.auth.detectSessionInUrl, false);
assert.match(options.auth.storageKey, /^spotcode-password-check-/);
assert.equal(credentials.email, actor.email);
assert.equal(credentials.password, 'correct dummy password');
assert.equal(signout.scope, 'local');

reset();
nextResult = { error: { message: 'Wrong password' } };
await assert.rejects(verify(), /Wrong password/);
assert.equal(active, activeSession);
assert.equal(signout.scope, 'local');

reset();
nextResult.data.session.user.id = 'different-account';
await assert.rejects(verify(), /ログイン状態が変わりました/);
assert.equal(signout.scope, 'local');

reset();
beforeResponse = () => { vm.runInContext('cachedUser = null', ctx); active = null; };
await assert.rejects(verify(), /ログイン状態が変わりました/);
assert.equal(signout.scope, 'local');

reset();
beforeResponse = () => { config = { url: 'https://changed.invalid', anonKey: 'dummy-anon' }; };
await assert.rejects(verify(), /ログイン状態が変わりました/);

reset();
active = null;
await assert.rejects(verify(), /ログイン状態が変わりました/);
assert.equal(options, null, 'no password request after account logout');

reset();
cleanupFails = true;
assert.equal(await verify(), true, 'temporary cleanup failure does not adopt AAL1 or reject correct password');
assert.equal(active, activeSession);
console.log('PASS isolated password verification: active AAL2 preservation, identity/config races, errors, local cleanup');
