// Run only in the security-review sandbox described by security-audit/SKILL.md.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync('src/js/data.js', 'utf8')
  .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const oldKey = 'spotcode:posts-cache:v1';
const key = 'spotcode:posts-cache:v2';
const scopes = ['home', 'following', 'spots', 'handle:alice', 'city:Tokyo', 'event:123'];
const audiences = ['public', 'mutuals', 'following', 'friends', 'org', 'restricted', 'github_org', 'only_me'];
const posts = audiences.map((visibility, i) => ({ id: String(i), authorId: 'A', visibility, body: 'A snapshot' }));
function harness(seed = []) {
  const storage = new Map(seed);
  let owner = 'A', dev = false, deferred = null;
  const context = vm.createContext({
    currentUser: () => owner ? { id: owner } : null,
    isDevMode: () => dev, isHiddenUser: () => false,
    canReadGithubOrganization: () => true,
    refreshGithubMembershipsIfNeeded: async () => {},
    t: value => value, getLocale: () => 'ja',
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    read: (_, fallback) => fallback, write() {}, KEYS: {}, console,
    isPostingAsOfficial: () => false,
    getClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: owner } } }) },
      from: table => {
        let single = false;
        const q = {};
        for (const method of ['select', 'order', 'limit', 'or', 'eq', 'not', 'in', 'insert', 'update']) q[method] = () => q;
        q.single = q.maybeSingle = () => { single = true; return q; };
        q.then = (resolve, reject) => {
          if (table === 'follows') return Promise.resolve({ data: [{ target_id: 'alice-id' }] }).then(resolve, reject);
          if (table === 'profiles') return Promise.resolve({ data: { id: 'alice-id' } }).then(resolve, reject);
          if (!deferred) return Promise.resolve({ data: single ? { id: 'fresh', author_id: owner, body: 'fresh' } : [] }).then(resolve, reject);
          deferred.started();
          return deferred.promise.then(data => ({ data: single ? data[0] : data })).then(resolve, reject);
        };
        return q;
      },
    }),
  });
  vm.runInContext(source, context);
  return {
    context, storage,
    switchTo(value) { owner = value; context.resetTimelineCaches(); },
    setDev(value) { dev = value; context.resetTimelineCaches(); },
    defer() {
      let release, started;
      const promise = new Promise(resolve => { release = resolve; });
      const ready = new Promise(resolve => { started = resolve; });
      deferred = { promise, started };
      return { release, ready };
    },
  };
}

// Reject legacy entries regardless of audience; missing owners are not anonymous.
for (const storageKey of [oldKey, key]) {
  const h = harness([[storageKey, JSON.stringify(Object.fromEntries(scopes.map(scope => [scope, { at: Date.now(), posts }])))] ]);
  for (const scope of scopes) assert.equal(h.context.cachedPosts(scope), null);
  assert.equal(h.storage.has(oldKey), false);
  assert.equal(h.storage.get(key), '{}');
}

const h = harness();
for (const scope of scopes) h.context.savePostsCache(scope, posts);
for (const scope of scopes) assert.equal(h.context.cachedPosts(scope).length, audiences.length);
const cold = harness([...h.storage]);
for (const scope of scopes) assert.equal(cold.context.cachedPosts(scope).length, audiences.length);
h.context.prependToTimelineCaches({ id: 'optimistic', authorHandle: 'alice', visibility: 'friends' });
h.context.resetTimelineCaches(); // Same-user profile refresh preserves valid state.
assert.equal(h.context.cachedPosts('home')[0].id, 'optimistic');
assert.equal(h.context.optimisticPostsForScope('home').length, 1);
h.context.markPendingDelete('new-B-post');
h.switchTo('B');
for (const scope of scopes) assert.equal(h.context.cachedPosts(scope), null);
assert.equal(h.storage.get(key), '{}');
assert.equal(h.context.optimisticPostsForScope('home').length, 0);
assert.equal(h.context.canDisplayCachedPost(posts[0]), false);
h.context.savePostsCache('home', [{ id: 'new-B-post' }]);
assert.equal(h.context.cachedPosts('home').length, 1); // A's tombstone was cleared.
h.switchTo(null);
assert.equal(h.context.cachedPosts('home'), null);
h.switchTo('A');
assert.equal(h.context.cachedPosts('home'), null); // Switching back cannot revive it.
h.setDev(true);
h.context.savePostsCache('home', [{ id: 'admin-expanded', visibility: 'friends' }]);
h.setDev(false);
assert.equal(h.context.cachedPosts('home'), null);

// All read paths must reject responses authorized before an account switch,
// including A -> B -> A while a request is unresolved.
const requests = [
  c => c.allPosts(), c => c.forYouPage(),
  c => c.forYouPage({ before: { createdAt: '2020-01-01', id: 'cursor' } }),
  c => c.followingPosts(), c => c.postsByHandle('alice'),
  c => c.likedPostsByHandle('alice'), c => c.postsByCity('Tokyo'),
  c => c.postsByEventId('123'), c => c.postsWithSpots(),
  c => c.postsWithGithubRefs(), c => c.getPost('private'),
  c => c.hydrateQuotedPosts([{ id: 'outer', quoteOfPostId: 'private' }]),
  c => c.addPost({ body: 'private' }), c => c.addQuote({ body: 'quote' }, 'private'),
  c => c.updatePost('private', { body: 'updated' }),
];
for (const request of requests) {
  for (const returnToA of [false, true]) {
    const fixture = harness();
    const pending = fixture.defer();
    const result = request(fixture.context);
    await pending.ready;
    fixture.switchTo('B');
    if (returnToA) fixture.switchTo('A');
    const rejected = assert.rejects(result, /アカウントが変更されました/);
    pending.release([{ id: 'private', body: 'A private row', author_id: 'A', visibility: 'friends' }]);
    await rejected;
    assert.equal(fixture.context.cachedPosts('home'), null);
    assert.equal(fixture.storage.get(key), '{}');
  }
}

// A resolved insert retained by a caller cannot later seed B's optimistic feed.
const insert = harness();
const created = await insert.context.addPost({ body: 'private' });
insert.switchTo('B');
assert.throws(() => insert.context.prependToTimelineCaches(created), /アカウントが変更されました/);
assert.equal(insert.context.cachedPosts('home'), null);
console.log('PASS timeline cache ownership, migration, transitions, optimistic state, and request races');
