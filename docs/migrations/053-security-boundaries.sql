-- Stage 53 — enforce database security boundaries.
-- Apply after Stage 52, as the SQL Editor owner. Reapplicable; no role resets.
begin;

-- A first-factor session remains useful for accounts without verified MFA.
-- Enrollment is read from Auth's trusted table, never user-editable metadata.
create or replace function public.session_has_required_aal()
returns boolean language sql stable security definer
set search_path = pg_catalog, public, auth as $$
 select auth.uid() is null
   or coalesce(auth.jwt()->>'aal', '') = 'aal2'
   or not exists (select 1 from auth.mfa_factors f
                  where f.user_id = auth.uid() and f.status = 'verified');
$$;
revoke all on function public.session_has_required_aal() from public;
grant execute on function public.session_has_required_aal() to anon, authenticated, service_role;

create or replace function public.require_session_aal()
returns void language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
 if not public.session_has_required_aal() then
  raise exception 'Second factor required' using errcode = '42501';
 end if;
end $$;
revoke all on function public.require_session_aal() from public;
grant execute on function public.require_session_aal() to anon, authenticated, service_role;

-- Restrictive policies cannot be bypassed by another permissive policy.
do $$ declare t record; begin
 for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
          where n.nspname='public' and c.relkind='r' and c.relrowsecurity loop
  execute format('drop policy if exists "require enrolled MFA" on public.%I', t.relname);
  execute format('create policy "require enrolled MFA" on public.%I as restrictive for all to anon, authenticated using (public.session_has_required_aal()) with check (public.session_has_required_aal())', t.relname);
 end loop;
end $$;

-- Definer functions intentionally bypass RLS, so callable mutations/secrets
-- receive the same check inside their trusted entry point (definitions below).

-- Staff and official-account designations are managed only by SQL/service roles.
-- Invoker trigger retains current_user: owner-side Auth provisioning still works.
create or replace function public.protect_profile_authority()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if current_user in ('anon','authenticated') then
  if tg_op = 'INSERT' then
   if coalesce(new.is_admin,false) or coalesce(new.is_operator,false) or coalesce(new.is_official,false) then
    raise exception 'Profile authority is server managed' using errcode='42501';
   end if;
  elsif new.is_admin is distinct from old.is_admin
     or new.is_operator is distinct from old.is_operator
     or new.is_official is distinct from old.is_official then
   raise exception 'Profile authority is server managed' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.protect_profile_authority() from public,anon,authenticated;
drop trigger if exists protect_profile_authority on public.profiles;
create trigger protect_profile_authority before insert or update on public.profiles
 for each row execute function public.protect_profile_authority();

-- Target approval is required even for a staff member following as official.
create or replace function public.protect_follow_identity()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if tg_op='UPDATE' and (new.follower_id is distinct from old.follower_id or new.target_id is distinct from old.target_id) then
  raise exception 'Follow identity is immutable' using errcode='42501';
 end if;
 if tg_op='INSERT' and current_user in ('anon','authenticated') then
  if exists(select 1 from public.profiles where id=new.target_id and is_private) then
   new.status := 'pending';
  else
   new.status := 'accepted';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.protect_follow_identity() from public,anon,authenticated;
drop trigger if exists protect_follow_identity on public.follows;
create trigger protect_follow_identity before insert or update on public.follows
 for each row execute function public.protect_follow_identity();

-- Resolve legacy handles ONCE. Historical recycling before this upgrade cannot
-- be reconstructed; owners should review pre-existing curated memberships.
-- NULL marks an unmigrated list. Empty UUID arrays are already migrated.
alter table public.profiles add column if not exists close_friend_ids uuid[];
alter table public.profiles add column if not exists org_member_ids uuid[];
update public.profiles p set close_friend_ids = array(
 select q.id from unnest(p.close_friends) with ordinality h(handle,ord)
 join public.profiles q on q.handle=h.handle order by h.ord)
 where close_friend_ids is null;
update public.profiles p set org_member_ids = array(
 select q.id from unnest(p.org_members) with ordinality h(handle,ord)
 join public.profiles q on q.handle=h.handle order by h.ord)
 where org_member_ids is null;
-- Normalize legacy display arrays to the same positions as their stable IDs.
update public.profiles p set close_friends = array(
 select q.handle from unnest(p.close_friend_ids) with ordinality i(id,ord)
 join public.profiles q on q.id=i.id order by i.ord),
 org_members = array(select q.handle from unnest(p.org_member_ids) with ordinality i(id,ord)
 join public.profiles q on q.id=i.id order by i.ord)
 where close_friends is distinct from array(select q.handle from unnest(p.close_friend_ids) with ordinality i(id,ord) join public.profiles q on q.id=i.id order by i.ord)
 or org_members is distinct from array(select q.handle from unnest(p.org_member_ids) with ordinality i(id,ord) join public.profiles q on q.id=i.id order by i.ord);
alter table public.profiles alter column close_friend_ids set default '{}';
alter table public.profiles alter column org_member_ids set default '{}';

-- Handles remain display snapshots for older readers. Legacy handle-only writes
-- fail closed: a stale retry after a rename cannot prove which principal the
-- editor selected. Updated clients submit UUIDs or use set_audience_member.
create or replace function public.sync_audience_identities()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if current_user in ('anon','authenticated') then
  if tg_op='INSERT' then
   if (coalesce(cardinality(new.close_friends),0)>0 and coalesce(cardinality(new.close_friend_ids),0)=0)
      or (coalesce(cardinality(new.org_members),0)>0 and coalesce(cardinality(new.org_member_ids),0)=0) then
    raise exception 'Audience edits require stable user IDs' using errcode='42501';
   end if;
  elsif (new.close_friends is distinct from old.close_friends and new.close_friend_ids is not distinct from old.close_friend_ids)
     or (new.org_members is distinct from old.org_members and new.org_member_ids is not distinct from old.org_member_ids) then
   raise exception 'Audience edits require stable user IDs' using errcode='42501';
  end if;
 end if;
 -- Preserve identities through renames, remove deleted principals, deduplicate.
 select coalesce(array_agg(q.id order by i.ord),'{}'),coalesce(array_agg(q.handle order by i.ord),'{}')
 into new.close_friend_ids,new.close_friends
 from (select id,min(ord) ord from unnest(coalesce(new.close_friend_ids,'{}')) with ordinality a(id,ord) group by id) i
 join public.profiles q on q.id=i.id;
 select coalesce(array_agg(q.id order by i.ord),'{}'),coalesce(array_agg(q.handle order by i.ord),'{}')
 into new.org_member_ids,new.org_members
 from (select id,min(ord) ord from unnest(coalesce(new.org_member_ids,'{}')) with ordinality a(id,ord) group by id) i
 join public.profiles q on q.id=i.id;
 return new;
end $$;
revoke all on function public.sync_audience_identities() from public,anon,authenticated;
drop trigger if exists sync_audience_identities on public.profiles;
create trigger sync_audience_identities before insert or update of close_friends,org_members,close_friend_ids,org_member_ids
 on public.profiles for each row execute function public.sync_audience_identities();

create or replace function public.set_audience_member(p_target uuid,p_kind text,p_enabled boolean)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare members uuid[];
begin
 perform public.require_session_aal();
 if auth.uid() is null or p_target is null or p_target=auth.uid() or p_kind is null or p_kind not in ('friends','org') or p_enabled is null then
  raise exception 'Invalid audience member';
 end if;
 if not exists(select 1 from public.profiles where id=p_target) then raise exception 'User not found'; end if;
 if p_enabled and not exists(select 1 from public.follows where follower_id=auth.uid() and target_id=p_target and status='accepted') then
  raise exception '先にこのユーザーをフォローしてください';
 end if;
 select case when p_kind='friends' then close_friend_ids else org_member_ids end into members
 from public.profiles where id=auth.uid() for update;
 members:=array_remove(coalesce(members,'{}'),p_target);
 if p_enabled then members:=array_append(members,p_target); end if;
 if p_kind='friends' then update public.profiles set close_friend_ids=members where id=auth.uid();
 else update public.profiles set org_member_ids=members where id=auth.uid(); end if;
end $$;
revoke all on function public.set_audience_member(uuid,text,boolean) from public,anon;
grant execute on function public.set_audience_member(uuid,text,boolean) to authenticated;

drop policy if exists "posts visible to allowed viewers" on public.posts;
create policy "posts visible to allowed viewers"
  on public.posts for select
  using (
    -- Anonymous + public-from-public-account.
    (
      posts.visibility = 'public'
      and exists (
        select 1 from public.profiles ap
        where ap.id = posts.author_id and not ap.is_private
      )
    )
    -- Author themselves.
    or auth.uid() = posts.author_id
    -- Admins (moderation).
    or exists (
      select 1 from public.profiles vp
      where vp.id = auth.uid() and vp.is_admin = true
    )
    -- Authenticated viewer rules.
    or exists (
      select 1 from public.profiles ap
      left join public.profiles vp on vp.id = auth.uid()
      where ap.id = posts.author_id
      and (
        -- Public post on a private account → approved follower OR
        -- close friend OR explicit org member.
        (
          ap.is_private and posts.visibility = 'public' and (
            exists (
              select 1 from public.follows f
              where f.follower_id = auth.uid()
              and f.target_id = ap.id
              and f.status = 'accepted'
            )
            or (vp.id is not null and vp.id = any(ap.close_friend_ids))
            or (vp.id is not null and vp.id = any(ap.org_member_ids))
          )
        )
        -- Mutual-only: both directions of follow must be accepted.
        or (
          posts.visibility = 'mutuals' and vp.id is not null
          and exists (
            select 1 from public.follows f1
            where f1.follower_id = auth.uid() and f1.target_id = ap.id
            and f1.status = 'accepted'
          )
          and exists (
            select 1 from public.follows f2
            where f2.follower_id = ap.id and f2.target_id = auth.uid()
            and f2.status = 'accepted'
          )
        )
        -- Following-only: the author follows the viewer.
        or (
          posts.visibility = 'following' and vp.id is not null
          and exists (
            select 1 from public.follows f
            where f.follower_id = ap.id and f.target_id = auth.uid()
            and f.status = 'accepted'
          )
        )
        -- Close friends only — viewer is on the author's curated list.
        or (
          posts.visibility = 'friends' and vp.id is not null
          and vp.id = any(ap.close_friend_ids)
        )
        -- Same-org only — viewer is on the author's curated org_members.
        or (
          posts.visibility = 'org' and vp.id is not null
          and vp.id = any(ap.org_member_ids)
        )
        -- Legacy "restricted" (Stage 16) — friends OR (curated org member).
        or (
          posts.visibility = 'restricted' and vp.id is not null and (
            vp.id = any(ap.close_friend_ids)
            or vp.id = any(ap.org_member_ids)
          )
        )
      )
    )
  );

-- Remove every historical permissive SELECT alternative before replacement.
drop policy if exists "reposts are public" on public.reposts;
drop policy if exists "users see reposts" on public.reposts;
drop policy if exists "reposts visible only on viewable posts" on public.reposts;
create policy "reposts visible only on viewable posts" on public.reposts for select
 using(exists(select 1 from public.posts p where p.id=reposts.post_id));
drop policy if exists "users see bookmarks" on public.bookmarks;
drop policy if exists "bookmarks visible only on viewable posts" on public.bookmarks;
drop policy if exists "bookmarks visible to owner or post author" on public.bookmarks;
create policy "bookmarks visible to owner or post author" on public.bookmarks for select
 using(auth.uid()=user_id or exists(select 1 from public.posts p where p.id=bookmarks.post_id and p.author_id=auth.uid()));

-- Public interactions require current authority to view their parent. Existing
-- personal bookmarks/references remain retained; their SELECT policies decide reads.
drop policy if exists "comments require readable parent" on public.comments;
create policy "comments require readable parent" on public.comments as restrictive for insert
 with check(exists(select 1 from public.posts p where p.id=comments.post_id));
drop policy if exists "likes require readable parent" on public.likes;
create policy "likes require readable parent" on public.likes as restrictive for insert
 with check(exists(select 1 from public.posts p where p.id=likes.post_id));
drop policy if exists "reposts require readable parent" on public.reposts;
create policy "reposts require readable parent" on public.reposts as restrictive for insert
 with check(exists(select 1 from public.posts p where p.id=reposts.post_id));

-- Ignore optional post context uniformly: blocking an account must not reveal
-- whether an inaccessible/deleted post UUID exists. Account review still works.
create or replace function public.block_user(p_target uuid,p_post uuid default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform public.require_session_aal();
 if auth.uid() is null or p_target is null or auth.uid()=p_target then raise exception 'Invalid block target'; end if;
 insert into public.user_blocks(blocker_id,blocked_id) values(auth.uid(),p_target) on conflict do nothing;
 if found then
  insert into public.moderation_events(reporter_id,target_id,post_id,kind,detail)
  values(auth.uid(),p_target,null,'block','User blocked this account. Review the account.');
 end if;
end $$;
revoke all on function public.block_user(uuid,uuid) from public,anon;
grant execute on function public.block_user(uuid,uuid) to authenticated;

-- Invoker trigger reads the parent under the caller's RLS, including MFA.
-- Numeric deadlineAt is milliseconds since epoch in both shipped clients.
create or replace function public.validate_poll_vote()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
declare definition jsonb;
begin
 if tg_op='UPDATE' and (new.post_id is distinct from old.post_id or new.user_id is distinct from old.user_id) then
  raise exception 'Vote identity is immutable' using errcode='42501';
 end if;
 select p.poll into definition from public.posts p where p.id=new.post_id;
 if definition is null or jsonb_typeof(definition->'options') is distinct from 'array'
    or jsonb_typeof(definition->'deadlineAt') is distinct from 'number' then
  raise exception 'Poll unavailable' using errcode='42501';
 end if;
 if new.option_idx < 0 or new.option_idx >= jsonb_array_length(definition->'options')
    or (definition->>'deadlineAt')::numeric <= extract(epoch from clock_timestamp())*1000 then
  raise exception 'Poll closed or invalid option' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function public.validate_poll_vote() from public,anon,authenticated;
drop trigger if exists validate_poll_vote on public.poll_votes;
create trigger validate_poll_vote before insert or update on public.poll_votes
 for each row execute function public.validate_poll_vote();

create or replace function public.ensure_dev_account(new_pass text)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_caller uuid := auth.uid();
  v_email  text := 'dev.test.account@spotcode-sns.local';
  v_handle text := 'spotcode_dev';
  v_name   text := 'spotcode dev';
  v_id     uuid;
  v_is_staff boolean;
begin
  perform public.require_session_aal();
  if v_caller is null then
    raise exception 'Sign in first.';
  end if;
  select (coalesce(is_admin, false) or coalesce(is_operator, false))
    into v_is_staff
  from public.profiles
  where id = v_caller;
  if not coalesce(v_is_staff, false) then
    raise exception 'admin / operator のみ実行できます。';
  end if;
  if new_pass is null or length(new_pass) < 8 then
    raise exception 'パスワードは 8 文字以上で設定してください。';
  end if;

  select id into v_id from auth.users where email = v_email;

  if v_id is null then
    insert into auth.users (
      id, instance_id, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      aud, role, raw_user_meta_data, raw_app_meta_data
    )
    values (
      gen_random_uuid(),
      '00000000-0000-0000-0000-000000000000',
      v_email,
      crypt(new_pass, gen_salt('bf')),
      now(), now(), now(),
      'authenticated', 'authenticated',
      jsonb_build_object('handle', v_handle, 'name', v_name),
      '{"provider":"email","providers":["email"]}'::jsonb
    )
    returning id into v_id;
  else
    update auth.users
    set encrypted_password = crypt(new_pass, gen_salt('bf')),
        updated_at         = now()
    where id = v_id;
  end if;

  insert into public.profiles (id, handle, name, role)
  values (v_id, v_handle, v_name, 'general')
  on conflict (id) do update set
    handle = excluded.handle,
    name   = excluded.name,
    role   = excluded.role;
end $$;

create or replace function public.save_github_private_issue_token(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_user uuid := auth.uid();
  v_secret uuid;
begin
  perform public.require_session_aal();
  if v_user is null then raise exception 'not authenticated'; end if;
  if nullif(trim(p_token), '') is null then raise exception 'empty token'; end if;
  select secret_id into v_secret from public.github_private_issue_grants where user_id = v_user;
  if v_secret is null then
    v_secret := vault.create_secret(p_token, 'spotcode-github-' || v_user::text, 'GitHub private Issue OAuth token');
    insert into public.github_private_issue_grants(user_id, secret_id)
    values (v_user, v_secret)
    on conflict (user_id) do update set secret_id = excluded.secret_id, updated_at = now();
  else
    perform vault.update_secret(v_secret, p_token);
    update public.github_private_issue_grants set updated_at = now() where user_id = v_user;
  end if;
  return true;
end $$;

create or replace function public.delete_github_private_issue_token()
returns boolean
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_secret uuid;
begin
  perform public.require_session_aal();
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from public.github_private_issue_grants where user_id = auth.uid() returning secret_id into v_secret;
  if v_secret is not null then delete from vault.secrets where id = v_secret; end if;
  return true;
end $$;

create or replace function public.exchange_business_cards(
  p_action text, p_id uuid default null, p_code text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  exchange public.business_card_exchanges%rowtype;
begin
  perform public.require_session_aal();
  if actor is null then raise exception 'Sign in required'; end if;
  if p_action = 'create' then
    if not exists(select 1 from public.business_cards where owner_id = actor) then
      raise exception 'Publish your business card first';
    end if;
    -- At most one active code per host. Old/completed exchanges retain receipts.
    perform 1 from public.business_cards where owner_id = actor for update;
    update public.business_card_exchanges set state = 'cancelled'
      where host_id = actor and state in ('waiting','pending');
    insert into public.business_card_exchanges(host_id) values(actor) returning * into exchange;
  elsif p_action = 'join' then
    select * into exchange from public.business_card_exchanges
      where code = upper(regexp_replace(coalesce(p_code,''), '[^a-zA-Z0-9]', '', 'g')) for update;
    if not found or exchange.expires_at <= now() or exchange.host_id = actor
       or exchange.state not in ('waiting','pending')
       or (exchange.guest_id is not null and exchange.guest_id <> actor) then
      raise exception 'Invalid or expired exchange code';
    end if;
    if not exists(select 1 from public.business_cards where owner_id = actor) then
      raise exception 'Publish your business card first';
    end if;
    if exists(select 1 from public.user_blocks where
        (blocker_id = actor and blocked_id = exchange.host_id) or
        (blocked_id = actor and blocker_id = exchange.host_id)) then
      raise exception 'Exchange unavailable';
    end if;
    update public.business_card_exchanges set guest_id = actor, state = 'pending'
      where id = exchange.id returning * into exchange;
  else
    select * into exchange from public.business_card_exchanges where id = p_id for update;
    if not found or (actor <> exchange.host_id and actor is distinct from exchange.guest_id) then
      raise exception 'Exchange unavailable';
    end if;
    if exchange.state in ('waiting','pending') and exchange.expires_at <= now() then
      update public.business_card_exchanges set state = 'expired' where id = exchange.id returning * into exchange;
    end if;
    if p_action = 'accept' then
      if actor <> exchange.host_id then raise exception 'Only the host may confirm'; end if;
      if exchange.state = 'pending' then
        if exists(select 1 from public.user_blocks where
            (blocker_id = exchange.host_id and blocked_id = exchange.guest_id) or
            (blocked_id = exchange.host_id and blocker_id = exchange.guest_id)) then
          raise exception 'Exchange unavailable';
        end if;
        -- Join is guest consent; accept is host consent. Save both or neither.
        insert into public.business_card_collection(collector_id, card_owner_id)
          values(exchange.host_id, exchange.guest_id), (exchange.guest_id, exchange.host_id)
          on conflict do nothing;
        update public.business_card_exchanges set state = 'completed' where id = exchange.id returning * into exchange;
      elsif exchange.state <> 'completed' then raise exception 'Exchange is not pending';
      end if;
    elsif p_action = 'cancel' then
      if exchange.state in ('waiting','pending') then
        update public.business_card_exchanges set state = 'cancelled' where id = exchange.id returning * into exchange;
      end if;
    elsif p_action <> 'status' then raise exception 'Unknown action';
    end if;
  end if;
  return jsonb_build_object('id',exchange.id,'code',exchange.code,'hostID',exchange.host_id,
    'guestID',exchange.guest_id,'state',exchange.state,'expiresAt',exchange.expires_at,
    'hostHandle',(select handle from public.profiles where id = exchange.host_id),
    'guestHandle',(select handle from public.profiles where id = exchange.guest_id));
end;
$$;

create or replace function public.get_github_private_issue_token()
returns text
language sql
stable
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets d
  join public.github_private_issue_grants g on g.secret_id = d.id
  where g.user_id = auth.uid() and public.session_has_required_aal()
  limit 1;
$$;

-- Policy helper RPCs also withhold account-specific answers before MFA.
create or replace function public.can_manage_official_profile()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.session_has_required_aal() and exists (
    select 1 from public.profiles
    where id = auth.uid()
      and (is_admin = true or is_operator = true)
  );
$$;

create or replace function public.is_verified_github_org_member(p_org bigint)
returns boolean language sql stable security definer set search_path = public,auth as $$
  select public.session_has_required_aal() and exists (
    select 1 from public.github_org_memberships m
    where m.user_id=auth.uid() and m.org_id=p_org and m.valid_until>now() and (
      exists(select 1 from auth.identities i where i.user_id=m.user_id and i.provider='github'
        and m.github_user_id::text in(i.identity_data->>'provider_id',i.identity_data->>'sub',i.identity_data->>'id'))
      or exists(select 1 from public.github_org_accounts a join public.profiles p on p.id=a.account_id
        where a.account_id=m.user_id and a.org_id=m.org_id and p.is_org=true
        and ((m.role='organization_file' and a.verification_method='file') or (m.role='admin' and a.verification_method is distinct from 'file')))
    )
  );
$$;

create or replace function public.has_blocked(p_target uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select public.session_has_required_aal() and exists(select 1 from user_blocks where blocker_id=auth.uid() and blocked_id=p_target);
$$;

notify pgrst, 'reload schema';
commit;
