import fs from 'node:fs';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const id = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
const [me, following, mutual, pending, outsider] = [1,2,3,4,5].map(id);
await db.exec(`create role anon; create role authenticated; create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table profiles(id uuid primary key,handle text,name text,avatar_url text,close_friends text[],org_members text[]);
create table follows(follower_id uuid,target_id uuid,status text);
create table posts(id uuid primary key,author_id uuid,organization_author_id uuid,body text,spot jsonb,created_at timestamptz,visibility text);
create table user_blocks(blocker_id uuid,blocked_id uuid);
alter table posts enable row level security;
create policy visible_posts on posts for select using(visibility='public' or author_id=auth.uid());
alter table profiles enable row level security;
create policy visible_profiles on profiles for select using(true);
grant usage on schema auth to authenticated;
grant select on profiles,follows,posts,user_blocks to authenticated;
`);
for (const [n, value] of [me,following,mutual,pending,outsider].entries()) {
 await db.query('insert into profiles values($1,$2,$2,null,$3,$3)',[value,'user'+n,[]]);
}
await db.query("insert into follows values($1,$2,'accepted'),($1,$3,'accepted'),($3,$1,'accepted'),($1,$4,'pending')",[me,following,mutual,pending]);
for (const [n, author] of [following,mutual,pending,outsider].entries()) {
 await db.query("insert into posts values($1,$2,null,'Hello',$3,now(),'public')",[id(10+n),author,JSON.stringify({addressDetails:{city:'渋谷区'},address:'東京都渋谷区1-2-3',lat:1,lng:2})]);
}
await db.query("insert into posts values($1,$2,null,'Secret',null,now(),'only_me')",[id(20),following]);
const migration = fs.readFileSync('docs/migrations/044-social-controls.sql','utf8');
await db.exec(migration); await db.exec(migration);
async function asUser(user) {
 await db.exec('reset role; set role authenticated');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
}
await asUser(me);
const notices = async scope => (await db.query('select * from followed_post_notifications($1)',[scope])).rows;
assert.equal((await notices('off')).length,0);
assert.equal((await notices('invalid')).length,0);
assert.equal((await notices('following')).length,2);
assert.deepEqual((await notices('mutuals')).map(r=>r.post.author_id),[mutual]);
assert((await notices('following')).every(r=>r.district==='渋谷区' && r.post.body!=='Secret'));
await db.query('insert into user_mutes(user_id,muted_id) values($1,$2)',[me,mutual]);
assert.equal((await notices('mutuals')).length,0);
assert.equal((await notices('following')).length,1);
await assert.rejects(db.query('insert into user_mutes(user_id,muted_id) values($1,$2)',[following,outsider]));
await asUser(following);
assert.equal((await db.query('select * from user_mutes')).rows.length,0);
await asUser(me);
await db.query('delete from user_mutes where muted_id=$1',[mutual]);
await db.exec('reset role');
await db.query('insert into user_blocks values($1,$2)',[me,following]);
await asUser(me);
assert.equal((await notices('following')).length,1);
await db.query('select set_audience_member($1,$2,true)',[following,'friends']);
await db.query('select set_audience_member($1,$2,true)',[mutual,'friends']);
await db.query('select set_audience_member($1,$2,true)',[following,'friends']);
await db.query('select set_audience_member($1,$2,true)',[mutual,'org']);
let profile = (await db.query('select * from profiles where id=$1',[me])).rows[0];
assert.deepEqual(new Set(profile.close_friends),new Set(['user1','user2']));
assert.deepEqual(profile.org_members,['user2']);
await db.query('select set_audience_member($1,$2,false)',[following,'friends']);
profile=(await db.query('select * from profiles where id=$1',[me])).rows[0];
assert.deepEqual(profile.close_friends,['user2']);
await assert.rejects(db.query('select set_audience_member($1,$2,true)',[pending,'friends']));
await assert.rejects(db.query('select set_audience_member($1,$2,true)',[me,'friends']));
await assert.rejects(db.query('select set_audience_member($1,$2,true)',[following,'invalid']));
await db.exec('reset role; set role anon');
await assert.rejects(db.query("select * from followed_post_notifications('following')"));
await db.close();
console.log('PASS mutual/accepted follows, private-post RLS, district-only context, mute/block exclusion, per-user mute RLS, atomic audience membership and denied anonymous access');
