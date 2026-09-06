import assert from 'node:assert/strict';
import { verifiedOrganizations, authorizedRepositories, githubPages } from '../supabase/functions/github-organizations/github.ts';

const fixtures = {
  '/user': { id: 7, login: 'me' },
  '/user/orgs': [{ id: 20, login: 'allowed' }],
  '/user/memberships/orgs': [
    { state: 'active', role: 'admin', organization: { id: 20, login: 'allowed' } },
    { state: 'active', role: 'member', organization: { id: 30, login: 'not-approved' } },
    { state: 'pending', role: 'member', organization: { id: 20, login: 'allowed' } },
  ],
  '/user/repos': [
    { id: 1, owner: { id: 7 }, private: false },
    { id: 2, owner: { id: 20 }, private: true },
    { id: 3, owner: { id: 30 }, private: true },
    { id: 4, owner: { id: 99 }, private: false },
  ],
};
const fakeFetch = async (input, init) => {
  assert.equal(init.headers.Authorization, 'Bearer test-token');
  return Response.json(fixtures[new URL(input).pathname]);
};
const verified = await verifiedOrganizations('test-token', ['7'], fakeFetch);
assert.deepEqual(verified.organizations, [{ id: 20, login: 'allowed', role: 'admin' }]);
assert.deepEqual((await authorizedRepositories('test-token', 7, verified.organizations, fakeFetch)).map(r => r.id), [1, 2]);
await assert.rejects(verifiedOrganizations('test-token', ['999'], fakeFetch), /連携済み/);
let calls = 0;
const paginated = await githubPages('/user/orgs', 'test-token', async () => Response.json(++calls === 1 ? Array(100).fill({ id: 1 }) : [{ id: 2 }]));
assert.equal(paginated.length, 101);
assert.equal(calls, 2);
calls = 0;
await assert.rejects(githubPages('/user/orgs', 'test-token', async () => ++calls === 1 ? Response.json(Array(100).fill({ id: 1 })) : new Response('', { status: 403 })));
console.log('PASS GitHub identity binding, active/approved organizations, repository ownership, pagination, and denied access');
