// Run with PGLITE_MODULE pointing to @electric-sql/pglite (test-only dependency).
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
import fs from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; grant usage on schema public,auth to anon,authenticated,service_role;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table public.profiles(id uuid primary key,is_org boolean default false,is_admin boolean default false);
create table auth.identities(user_id uuid,provider text,identity_data jsonb);
create table public.posts(id int primary key,author_id uuid references public.profiles(id),body text,visibility text);
alter table public.posts enable row level security;
grant all on public.posts,public.profiles to service_role;
grant select on public.profiles to anon,authenticated;
grant select,insert,update,delete on public.posts to authenticated; grant select on public.posts to anon;
create policy baseline_read on public.posts for select using(visibility='public' or author_id=auth.uid() or exists(select 1 from profiles p where p.id=auth.uid() and p.is_admin));
create policy baseline_insert on public.posts for insert with check(author_id=auth.uid());
create policy baseline_update on public.posts for update using(author_id=auth.uid()) with check(author_id=auth.uid());
`);
await db.exec(fs.readFileSync(process.cwd()+'/docs/migrations/038-github-organizations.sql','utf8'));
const ids = ['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004'];
for(let i=0;i<ids.length;i++) await db.query(`insert into profiles values ($1,$2,$3);`,[ids[i],i===0,i===3]);
for(let i=0;i<ids.length;i++) await db.query(`insert into auth.identities values($1,'github',$2::jsonb)`,[ids[i],JSON.stringify({sub:String(i+100)})]);
await db.exec(`set role service_role`);
for(let i=0;i<2;i++) await db.query(`select public.replace_github_org_memberships($1,$2,$3::jsonb)`,[ids[i],i+100,JSON.stringify([{id:20,login:'org',role:i===0?'admin':'member'}])]);
await db.query(`insert into github_org_accounts values($1,20,'org')`,[ids[0]]);
async function asUser(i,dev=false) {
  await db.exec('reset role; set role authenticated');
  await db.query(`select set_config('request.jwt.claim.sub',$1,false),set_config('request.headers',$2,false)`,[ids[i],JSON.stringify(dev?{'x-spotcode-dev-mode':'1'}:{})]);
}
await db.exec("reset role; alter table posts add column repo_full_name text; alter table posts add column github_link text; alter table posts add column created_at timestamptz default now()");
const migration = fs.readFileSync(process.cwd()+'/docs/migrations/039-organization-post-attribution.sql','utf8');
await db.exec(migration);
await db.exec(migration); // safe SQL Editor rerun
async function insert(id, author, repository, link, visibility='public', spoof=null) {
  return db.query(`insert into posts(id,author_id,body,visibility,repo_full_name,github_link,organization_author_id)
    values($1,$2,'Contribution',$3,$4,$5,$6) returning *`,[id,author,visibility,repository,link,spoof]);
}
await asUser(1);
let post=(await insert(1,ids[1],'org/repo',null)).rows[0];
assert.equal(post.author_id,ids[1]); assert.equal(post.organization_author_id,ids[0]);
assert.equal((await insert(2,ids[1],null,'https://github.com/ORG/repo/issues/1')).rows[0].organization_author_id,ids[0]);
assert.equal((await insert(3,ids[1],'personal/repo',null,'public',ids[0])).rows[0].organization_author_id,null);
assert.equal((await insert(4,ids[1],null,'https://github.com.evil.test/org/repo')).rows[0].organization_author_id,null);
assert.equal((await insert(5,ids[1],'org/repo',null,'github_org')).rows[0].github_org_id,20);
assert.equal((await insert(6,ids[1],'org/repo',null,'only_me')).rows[0].visibility,'only_me');
await asUser(0);
assert.equal((await db.query('select * from posts where id=6')).rows.length,0);
assert.equal((await db.query("update posts set body='Hijacked' where id=1 returning *")).rows.length,0);
await asUser(2);
assert.equal((await insert(7,ids[2],'org/repo',null,'public',ids[0])).rows[0].organization_author_id,null);
assert.equal((await db.query('select * from posts where id=5')).rows.length,0);
await assert.rejects(insert(8,ids[2],'org/repo',null,'github_org'));
await db.exec('reset role');
await db.query("update github_org_memberships set valid_until=now()-interval '1 second' where user_id=$1",[ids[1]]);
await asUser(1);
assert.equal((await insert(9,ids[1],'org/repo',null)).rows[0].organization_author_id,null);
assert.equal((await db.query("update posts set organization_author_id=null, body='Edited' where id=1 returning *")).rows[0].organization_author_id,ids[0]);
assert.equal((await db.query("update posts set repo_full_name='personal/repo' where id=1 returning *")).rows[0].organization_author_id,null);
await db.exec('reset role');
await db.query("update github_org_memberships set valid_until=now()+interval '1 hour' where user_id=$1",[ids[1]]);
await db.query('update profiles set is_org=true where id=$1',[ids[2]]);
await db.query("insert into github_org_accounts values($1,20,'org')",[ids[2]]);
await asUser(1);
await assert.rejects(insert(10,ids[1],'org/repo',null),/Multiple organization accounts/);
await db.exec('reset role');
await db.query('delete from profiles where id=$1',[ids[0]]);
assert.equal((await db.query('select organization_author_id from posts where id=2')).rows[0].organization_author_id,null);
console.log('PASS organization attribution: member, nonmember, URL validation, spoofing, audience, edit ownership, expiry, repository edits, ambiguity, migration rerun');
await db.close();
