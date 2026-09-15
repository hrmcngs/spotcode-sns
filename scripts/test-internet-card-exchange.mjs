import fs from 'node:fs';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const id = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
const [host, guest, outsider] = [1, 2, 3].map(id);
await db.exec(`create role anon; create role authenticated; create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated;
create table profiles(id uuid primary key, handle text);
create table user_blocks(blocker_id uuid, blocked_id uuid);
`);
for (const migration of ['045-business-cards.sql','048-business-card-collection-read.sql','049-internet-card-exchange.sql']) {
 await db.exec(fs.readFileSync('docs/migrations/' + migration, 'utf8'));
}
for (const [index, actor] of [host, guest, outsider].entries()) {
 await db.query('insert into profiles values($1,$2)', [actor, 'person' + index]);
 await db.query('insert into business_cards(owner_id,name,contact) values($1,$2,$3)', [actor, 'Card ' + index, 'secret ' + index]);
}
async function as(actor) {
 await db.exec('reset role');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor || '']);
 await db.exec('set role authenticated');
}
async function action(name, exchange = null, code = null) {
 return (await db.query('select exchange_business_cards($1,$2,$3) as result', [name, exchange, code])).rows[0].result;
}
await as(host);
const created = await action('create'); assert.equal(created.state, 'waiting'); assert.equal(created.code.length, 12);
await assert.rejects(action('join', null, created.code), /Invalid/);
await as(outsider);
await assert.rejects(action('status', created.id), /unavailable/);
await assert.rejects(db.query('select * from business_card_exchanges'), /permission denied/);
await as(guest);
assert.equal((await db.query('select * from business_cards where owner_id=$1', [host])).rows.length, 0);
const joined = await action('join', null, created.code.toLowerCase()); assert.equal(joined.state, 'pending');
assert.equal((await db.query('select * from business_card_collection')).rows.length, 0, 'Join alone never saves cards');
assert.equal((await db.query('select * from business_cards where owner_id=$1', [host])).rows.length, 0);
await assert.rejects(action('accept', created.id), /Only the host/);
await as(outsider); await assert.rejects(action('join', null, created.code), /Invalid/);
await as(host);
assert.equal((await action('status', created.id)).guestID, guest);
assert.equal((await action('accept', created.id)).state, 'completed');
assert.equal((await action('accept', created.id)).state, 'completed');
assert.equal((await db.query('select * from business_card_collection')).rows.length, 1);
assert.equal((await db.query('select * from business_cards where owner_id=$1', [guest])).rows.length, 1);
await as(guest);
assert.equal((await db.query('select * from business_card_collection')).rows.length, 1);
assert.equal((await action('status', created.id)).state, 'completed');
await as(host); const expired = await action('create');
await db.exec('reset role'); await db.query("update business_card_exchanges set expires_at=now()-interval '1 second' where id=$1", [expired.id]);
await as(guest); await assert.rejects(action('join', null, expired.code), /expired/);
await as(host); assert.equal((await action('status', expired.id)).state, 'expired');
const cancelled = await action('create'); await action('cancel', cancelled.id);
await as(guest); await assert.rejects(action('join', null, cancelled.code), /Invalid/);
await as(host); const blocked = await action('create');
await db.exec('reset role'); await db.query('insert into user_blocks values($1,$2)', [guest, host]);
await as(guest); await assert.rejects(action('join', null, blocked.code), /unavailable/);
await as(null); await assert.rejects(action('create'), /Sign in/);
await db.close();
console.log('PASS real SQL: isolated codes, expiry, same-user/outsider denial, both consents, atomic mutual save, retry, cancellation, blocks, private card access');
