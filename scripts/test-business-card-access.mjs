import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createTestI18n } from './helpers/i18n.mjs';
let user = null, saved = false, fail = false;
const reads = [];
const db = { from(table) {
  reads.push(table);
  const filters = {};
  const q = { select() { return q; }, eq(key, value) { filters[key] = value; return q; },
    async maybeSingle() {
      if (table === 'profiles') return { data: { id: 'owner', handle: 'owner' } };
      if (table === 'business_card_collection') {
        assert.equal(filters.collector_id, user.id);
        assert.equal(filters.card_owner_id, 'owner');
        return fail ? { error: { message: 'offline' } } : { data: saved ? { card_owner_id: 'owner' } : null };
      }
      return { data: { owner_id: 'owner', contact: 'private contact' } };
    }
  }; return q;
} };
const ctx = vm.createContext({ ...createTestI18n(), currentUser: () => user, getClient: async () => db, URL });
vm.runInContext(fs.readFileSync('src/js/business-cards.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), ctx);
const load = () => vm.runInContext("loadCard('owner')", ctx);
for (const viewer of [null, { id: 'other' }]) {
  user = viewer; reads.length = 0;
  assert.equal((await load()).restricted, true);
  assert(!reads.includes('business_cards'), 'Denied viewers must not fetch card contents');
}
user = { id: 'owner' }; reads.length = 0;
assert.equal((await load()).card.contact, 'private contact');
assert(!reads.includes('business_card_collection'));
user = { id: 'other' }; saved = true;
assert.equal((await load()).card.contact, 'private contact');
saved = false; reads.length = 0;
assert.equal((await load()).restricted, true);
assert(!reads.includes('business_cards'), 'Removing a card must revoke subsequent access');
fail = true; reads.length = 0;
await assert.rejects(load());
assert(!reads.includes('business_cards'), 'Membership errors must fail closed');
const sql = fs.readFileSync('docs/migrations/048-business-card-collection-read.sql', 'utf8');
assert.match(sql, /drop policy if exists "published cards are readable"/);
assert.match(sql, /revoke select on public.business_cards from anon/);
assert.match(sql, /c.collector_id = \(select auth.uid\(\)\)/);
assert.match(sql, /c.card_owner_id = business_cards.owner_id/);
console.log('PASS guest/uncollected denial, own/collected access, removal, fail-closed lookup, SQL policy guards');
