// Run only in an isolated, resource-limited, offline fixture environment.
// No Supabase/production connection: these are dummy Auth/Vault fixtures.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const modulePath = process.env.PGLITE_MODULE || '@electric-sql/pglite';
const { PGlite } = await import(modulePath);
const { pgcrypto } = await import(modulePath.includes('/') ? new URL('./contrib/pgcrypto.js', 'file://' + modulePath).href : '@electric-sql/pglite/contrib/pgcrypto');
const db = new PGlite({ extensions: { pgcrypto } });
const schema = fs.readFileSync('docs/supabase-schema.sql', 'utf8').replace('create extension if not exists supabase_vault cascade;', '-- local Vault fixture');
const migration = fs.readFileSync('docs/migrations/053-security-boundaries.sql', 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const [a,b,c,d,staff] = [1,2,3,4,5].map(id);
const query = (sql, params=[]) => db.query(sql, params);
const rows = async (sql, params=[]) => (await query(sql, params)).rows;
const as = async (user, aal='aal1', role='authenticated') => {
  await db.exec('reset role');
  await query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)", [user || '', JSON.stringify({ sub: user, aal })]);
  await db.exec(`set role ${role}`);
};
const owner = async () => {
  await db.exec('reset role');
  await query("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','{}',false)");
};
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
    create table auth.users(id uuid primary key,instance_id uuid,email text,encrypted_password text,email_confirmed_at timestamptz,created_at timestamptz,updated_at timestamptz,aud text,role text,raw_user_meta_data jsonb,raw_app_meta_data jsonb);
    create table auth.identities(user_id uuid,provider text,identity_data jsonb);
    create table auth.mfa_factors(id uuid primary key,user_id uuid,status text);
    grant usage on schema auth to anon,authenticated;
    create schema vault;
    create table vault.secrets(id uuid primary key,decrypted_secret text);
    create view vault.decrypted_secrets as select * from vault.secrets;
  `);
  // Upgrade from Stage 52 with legacy handles, then reapply migration twice.
  await db.exec(schema.slice(0, schema.indexOf('-- Stage 53 — security boundaries')) + '\ncommit;');
  for (const [i,user] of [a,b,c,d,staff].entries()) {
    await query('insert into auth.users(id,raw_user_meta_data) values($1,$2)', [user, JSON.stringify({handle:`person_${i}`,name:`Person ${i}`})]);
  }
  await query('update profiles set close_friends=$1,org_members=$1 where id=$2', [['person_1'],a]);
  await query('update profiles set is_private=true where id=$1',[d]);
  await query('update profiles set is_operator=true where id=$1',[staff]);
  await db.exec(migration);
  await db.exec(migration);
  assert.deepEqual((await rows('select close_friend_ids,org_member_ids from profiles where id=$1',[a]))[0], {close_friend_ids:[b],org_member_ids:[b]});
  await db.exec(`grant select,insert,update,delete on public.profiles,public.posts,public.follows,public.comments,public.likes,public.reposts,public.bookmarks,public.poll_votes to authenticated;
    grant select on public.profiles,public.posts,public.follows,public.comments,public.likes,public.reposts,public.bookmarks,public.poll_votes to anon;`);

  await as(a);
  await assert.rejects(query('update profiles set is_admin=true where id=$1',[a]), /server managed/);
  await assert.rejects(query('update profiles set is_operator=true where id=$1',[a]), /server managed/);
  await assert.rejects(query('update profiles set is_official=true where id=$1',[a]), /server managed/);
  await query("update profiles set bio='ordinary edit' where id=$1",[a]);
  // Insert path remains guarded even when the ordinary owner INSERT policy permits it.
  await owner();
  const fresh=id(6);
  await query('insert into auth.users(id,raw_user_meta_data) values($1,$2)',[fresh,JSON.stringify({handle:'fresh_user'})]);
  await query('delete from profiles where id=$1',[fresh]);
  await as(fresh);
  await assert.rejects(query("insert into profiles(id,handle,name,is_admin) values($1,'fresh_user','Fresh',true)",[fresh]),/server managed/);
  await query("insert into profiles(id,handle,name) values($1,'fresh_user','Fresh')",[fresh]);

  const privatePost=id(100), friends=id(101), publicPost=id(102), following=id(103), privateAccountPost=id(104), poll=id(105), org=id(106), restricted=id(107);
  await owner();
  for (const [post,author,visibility] of [[privatePost,a,'only_me'],[friends,a,'friends'],[publicPost,a,'public'],[following,c,'following'],[privateAccountPost,d,'public'],[poll,a,'public'],[org,a,'org'],[restricted,a,'restricted']]) {
    await query('insert into posts(id,author_id,body,visibility) values($1,$2,$3,$4)',[post,author,'DUMMY',visibility]);
  }
  await query("update posts set poll=jsonb_build_object('options',jsonb_build_array('A','B'),'deadlineAt',(extract(epoch from now())+3600)*1000) where id=$1",[poll]);

  await as(b);
  await query("insert into follows(follower_id,target_id,status) values($1,$2,'accepted')",[b,d]);
  assert.equal((await rows('select status from follows where follower_id=$1 and target_id=$2',[b,d]))[0].status,'pending');
  assert.equal((await rows('select id from posts where id=$1',[privateAccountPost])).length,0);
  await as(d);
  await assert.rejects(query("update follows set follower_id=$1,status='accepted' where follower_id=$2 and target_id=$3",[c,b,d]),/immutable/);
  await query("update follows set status='accepted' where follower_id=$1 and target_id=$2",[b,d]);
  await as(b);
  assert.equal((await rows('select id from posts where id=$1',[privateAccountPost])).length,1);
  await as(staff);
  const official=(await rows('select id from profiles where is_official'))[0].id;
  await query("insert into follows(follower_id,target_id,status) values($1,$2,'accepted')",[official,d]);
  assert.equal((await rows('select status from follows where follower_id=$1 and target_id=$2',[official,d]))[0].status,'pending');
  await query("insert into posts(author_id,body) values($1,'official staff post')",[official]);

  // Renaming and recycling a selected handle never transfers audience authority.
  await as(b);
  await query("update profiles set handle='renamed_b' where id=$1",[b]);
  await as(c);
  await query("update profiles set handle='person_1' where id=$1",[c]);
  for (const audiencePost of [friends,org,restricted]) {
    assert.equal((await rows('select id from posts where id=$1',[audiencePost])).length,0);
  }
  await as(b);
  assert.equal((await rows('select id from posts where id=any($1::uuid[])',[[friends,org,restricted]])).length,3);
  await as(a);
  // Both the first stale handle-only edit and a repeated retry fail closed.
  for (let retry=0;retry<2;retry++) {
    await assert.rejects(query('update profiles set close_friends=$1 where id=$2',[['person_1','person_3'],a]),/stable user IDs/);
  }
  await query('update profiles set close_friend_ids=$1 where id=$2',[[b,d],a]);
  assert.deepEqual((await rows('select close_friend_ids from profiles where id=$1',[a]))[0].close_friend_ids,[b,d]);
  await assert.rejects(query('update profiles set close_friends=$1 where id=$2',[['person_1','person_3'],a]),/stable user IDs/);
  await query("insert into follows(follower_id,target_id) values($1,$2)",[a,b]);
  await query("select set_audience_member($1,'friends',false)",[b]);
  await query("select set_audience_member($1,'friends',true)",[b]);
  assert.ok((await rows('select close_friend_ids from profiles where id=$1',[a]))[0].close_friend_ids.includes(b));

  await as(b);
  await query('insert into bookmarks(post_id,user_id) values($1,$2)',[publicPost,b]);
  await as(c);
  assert.equal((await rows('select * from bookmarks where post_id=$1',[publicPost])).length,0);
  await as(a);
  assert.equal((await rows('select * from bookmarks where post_id=$1',[publicPost])).length,1);
  await query('insert into reposts(post_id,user_id) values($1,$2)',[privatePost,a]);
  await as(c);
  assert.equal((await rows('select * from reposts where post_id=$1',[privatePost])).length,0);
  await as(null,'aal1','anon');
  assert.equal((await rows('select * from reposts where post_id=$1',[privatePost])).length,0);
  await as(c);
  await assert.rejects(query("insert into comments(post_id,author_id,body) values($1,$2,'hidden write')",[privatePost,c]),/row-level security/);
  await assert.rejects(query('insert into likes(post_id,user_id) values($1,$2)',[privatePost,c]),/row-level security/);
  await assert.rejects(query('insert into reposts(post_id,user_id) values($1,$2)',[privatePost,c]),/row-level security/);
  await query("insert into comments(post_id,author_id,body) values($1,$2,'visible write')",[publicPost,c]);

  // Hidden and absent post context have the same success result and NULL event ID.
  await query('select block_user($1,$2)',[b,privatePost]);
  await query('delete from user_blocks where blocker_id=$1 and blocked_id=$2',[c,b]);
  await query('select block_user($1,$2)',[b,id(999)]);
  await owner();
  assert.deepEqual((await rows("select post_id from moderation_events where reporter_id=$1 and kind='block'",[c])).map(x=>x.post_id),[null,null]);

  await as(b);
  await query('insert into poll_votes(post_id,user_id,option_idx) values($1,$2,0)',[poll,b]);
  await query('update poll_votes set option_idx=1 where post_id=$1',[poll]);
  await assert.rejects(query('update poll_votes set option_idx=2 where post_id=$1',[poll]),/invalid option/);
  await assert.rejects(query('update poll_votes set option_idx=-1 where post_id=$1',[poll]),/invalid option/);
  await assert.rejects(query('insert into poll_votes(post_id,user_id,option_idx) values($1,$2,0)',[privatePost,b]),/Poll unavailable/);
  await owner();
  await query("update posts set poll=jsonb_set(poll,'{deadlineAt}',to_jsonb((extract(epoch from now())-1)*1000)) where id=$1",[poll]);
  await as(b);
  await assert.rejects(query('update poll_votes set option_idx=0 where post_id=$1',[poll]),/Poll closed/);
  await as(c);
  await assert.rejects(query('insert into poll_votes(post_id,user_id,option_idx) values($1,$2,0)',[poll,c]),/Poll closed/);

  // Verified enrollment requires aal2; unverified or absent enrollment does not.
  await owner();
  await query("insert into vault.secrets values($1,'DUMMY_GITHUB_TOKEN')",[id(200)]);
  await query('insert into github_private_issue_grants(user_id,secret_id) values($1,$2)',[a,id(200)]);
  await query("insert into auth.mfa_factors values($1,$2,'verified'),($3,$4,'unverified')",[id(201),a,id(202),b]);
  await as(a);
  assert.equal((await rows('select id from posts where id=$1',[privatePost])).length,0);
  assert.equal((await rows('select get_github_private_issue_token() as token'))[0].token,null);
  for (const [sql,params] of [
    ['select save_github_private_issue_token($1)',['dummy']],
    ['select delete_github_private_issue_token()',[]],
    ['select ensure_dev_account($1)',['dummy-pass']],
    ['select block_user($1)',[b]],
    ["select set_audience_member($1,'friends',false)",[b]],
    ["select exchange_business_cards('create')",[]],
  ]) await assert.rejects(query(sql,params),/Second factor required/);
  await as(a,'aal2');
  assert.equal((await rows('select id from posts where id=$1',[privatePost])).length,1);
  assert.equal((await rows('select get_github_private_issue_token() as token'))[0].token,'DUMMY_GITHUB_TOKEN');
  await as(b);
  assert.equal((await rows('select id from posts where id=$1',[friends])).length,1);
  await as(c);
  assert.equal((await rows('select id from posts where id=$1',[publicPost])).length,1);

  await owner();
  const policies = () => rows("select tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='public' order by tablename,policyname");
  const before = await policies();
  await db.exec(schema);
  await db.exec(migration);
  assert.deepEqual(await policies(),before,'fresh/upgrade/repeat produce the same final policies');
  assert.equal((await rows('select is_operator from profiles where id=$1',[staff]))[0].is_operator,true);
  await as(c);
  assert.equal((await rows('select id from posts where id=$1',[friends])).length,0,'repeat never rebinds recycled handles');
  console.log('PASS security boundaries: roles, MFA, follows, UUID audiences, private interactions, block context, poll state, upgrade/repeat');
} finally {
  await db.close();
}
