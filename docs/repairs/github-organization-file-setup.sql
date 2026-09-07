-- Run this entire file in Supabase SQL Editor.
-- Installs Organization prerequisites and the organization-account grant together.
-- Existing profiles/posts are preserved. The complete repair is one transaction.
begin;

-- Source: 038-github-organizations.sql
-- Verified GitHub Organization membership and post audiences.

create table if not exists public.github_org_memberships (
  user_id uuid not null references public.profiles(id) on delete cascade,
  github_user_id bigint not null,
  org_id bigint not null,
  login text not null,
  role text not null,
  valid_until timestamptz not null,
  primary key(user_id, org_id)
);
create table if not exists public.github_org_accounts (
  account_id uuid primary key references public.profiles(id) on delete cascade,
  org_id bigint not null,
  login text not null
);
alter table public.github_org_memberships enable row level security;
alter table public.github_org_accounts enable row level security;
revoke all on public.github_org_memberships, public.github_org_accounts from anon, authenticated;
grant select on public.github_org_memberships, public.github_org_accounts to authenticated;
grant all on public.github_org_memberships, public.github_org_accounts to service_role;
drop policy if exists "read own github memberships" on public.github_org_memberships;
create policy "read own github memberships" on public.github_org_memberships for select using (user_id = auth.uid());
drop policy if exists "read own github org link" on public.github_org_accounts;
create policy "read own github org link" on public.github_org_accounts for select using (account_id = auth.uid());

create or replace function public.replace_github_org_memberships(p_user uuid, p_github_user bigint, p_organizations jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Serializes concurrent syncs for the same user.
  perform 1 from public.profiles where id = p_user for update;
  delete from public.github_org_memberships where user_id = p_user;
  insert into public.github_org_memberships(user_id, github_user_id, org_id, login, role, valid_until)
  select p_user, p_github_user, (item->>'id')::bigint, item->>'login', item->>'role', now() + interval '1 hour'
  from jsonb_array_elements(p_organizations) item;
end $$;
revoke all on function public.replace_github_org_memberships(uuid,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.replace_github_org_memberships(uuid,bigint,jsonb) to service_role;

create or replace function public.is_verified_github_org_member(p_org bigint)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.github_org_memberships m
    join auth.identities i on i.user_id = m.user_id and i.provider = 'github'
    where m.user_id = auth.uid() and m.org_id = p_org and m.valid_until > now()
      and m.github_user_id::text in (i.identity_data->>'provider_id', i.identity_data->>'sub', i.identity_data->>'id')
  );
$$;
revoke all on function public.is_verified_github_org_member(bigint) from public, anon;
grant execute on function public.is_verified_github_org_member(bigint) to anon, authenticated;

alter table public.posts add column if not exists github_org_id bigint;
alter table public.posts drop constraint if exists posts_visibility_check;
alter table public.posts add constraint posts_visibility_check check (visibility in ('public','restricted','mutuals','following','friends','org','only_me','github_org'));

create or replace function public.stamp_post_github_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.visibility = 'github_org' then
    if tg_op = 'UPDATE' then
      if old.visibility = 'github_org' and old.author_id = new.author_id then
        new.github_org_id := old.github_org_id;
        return new;
      end if;
    end if;
    select o.org_id into new.github_org_id from public.github_org_accounts o
      join public.profiles p on p.id = o.account_id and p.is_org = true
      where o.account_id = new.author_id;
    if new.github_org_id is null then raise exception 'Link a GitHub Organization in account settings first'; end if;
    if not public.is_verified_github_org_member(new.github_org_id) then raise exception 'Refresh your GitHub Organization membership first'; end if;
  else
    new.github_org_id := null;
  end if;
  return new;
end $$;
revoke all on function public.stamp_post_github_org() from public, anon, authenticated;
drop trigger if exists stamp_post_github_org on public.posts;
create trigger stamp_post_github_org before insert or update on public.posts for each row execute function public.stamp_post_github_org();

-- Additional permissive path for verified members; restrictive guard also
-- prevents unrelated existing moderation/public policies from opening posts.
drop policy if exists "github org members read posts" on public.posts;
create policy "github org members read posts" on public.posts for select to authenticated
using (visibility = 'github_org' and public.is_verified_github_org_member(github_org_id));
drop policy if exists "github org post audience" on public.posts;
create policy "github org post audience" on public.posts as restrictive for select
using (
  visibility is distinct from 'github_org' or author_id = auth.uid()
  or (auth.uid() is not null and public.is_verified_github_org_member(github_org_id))
  or (
    coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-spotcode-dev-mode', '') = '1'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  )
);


-- Source: 039-organization-post-attribution.sql
-- Stage 39: Display member contributions under the linked organization account.
-- Requires Stage 38. author_id remains the actual author for ownership/audiences.

alter table public.posts add column if not exists organization_author_id uuid
  references public.profiles(id) on delete set null;
-- Also repair installations where the column existed without its foreign key.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.posts'::regclass
    and conname = 'posts_organization_author_id_fkey') then
    alter table public.posts add constraint posts_organization_author_id_fkey
      foreign key (organization_author_id) references public.profiles(id) on delete set null;
  end if;
end $$;
create index if not exists posts_organization_author_idx
  on public.posts(organization_author_id, created_at desc) where organization_author_id is not null;

create or replace function public.stamp_post_organization_author()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  repository text;
  owner_login text;
  candidates uuid[];
begin
  -- Attribution is historical. Body/audience edits must not change it after
  -- the member leaves, the link is removed, or the organization is renamed.
  if tg_op = 'UPDATE' then
    if new.author_id = old.author_id
      and new.repo_full_name is not distinct from old.repo_full_name
      and new.github_link is not distinct from old.github_link then
      select p.id into new.organization_author_id from public.profiles p
        where p.id = old.organization_author_id;
      return new;
    end if;
  end if;
  new.organization_author_id := null;
  -- Official-account overlays and moderation never impersonate a member.
  if new.author_id is distinct from auth.uid() then return new; end if;
  repository := nullif(btrim(new.repo_full_name), '');
  if repository is null then
    repository := substring(new.github_link from '(?i)^https://github\.com/([a-z0-9-]+/[a-z0-9_.-]+)(?:[/?#]|$)');
  end if;
  if repository is null or repository !~* '^[a-z0-9-]+/[a-z0-9_.-]+$' then return new; end if;
  owner_login := lower(split_part(repository, '/', 1));
  select array_agg(a.account_id) into candidates
    from public.github_org_accounts a
    join public.profiles p on p.id = a.account_id and p.is_org = true
    where lower(a.login) = owner_login and public.is_verified_github_org_member(a.org_id)
      and exists (select 1 from public.github_org_memberships m
        where m.user_id = auth.uid() and m.org_id = a.org_id and lower(m.login) = owner_login);
  if cardinality(candidates) > 1 then
    raise exception 'Multiple organization accounts are linked to this GitHub Organization. Keep one account linked before posting.';
  end if;
  new.organization_author_id := candidates[1];
  return new;
end $$;
revoke all on function public.stamp_post_organization_author() from public, anon, authenticated;
drop trigger if exists stamp_post_00_organization_author on public.posts;
-- PostgreSQL runs same-event triggers alphabetically, before the audience stamp.
create trigger stamp_post_00_organization_author before insert or update on public.posts
  for each row execute function public.stamp_post_organization_author();

create or replace function public.stamp_post_github_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.visibility = 'github_org' then
    if tg_op = 'UPDATE' then
      if old.visibility = 'github_org' and old.author_id = new.author_id then
        new.github_org_id := old.github_org_id;
        return new;
      end if;
    end if;
    select o.org_id into new.github_org_id from public.github_org_accounts o
      join public.profiles p on p.id = o.account_id and p.is_org = true
      where o.account_id = coalesce(new.organization_author_id, new.author_id);
    if new.github_org_id is null then raise exception 'Link a GitHub Organization or select its repository first'; end if;
    if not public.is_verified_github_org_member(new.github_org_id) then raise exception 'Refresh your GitHub Organization membership first'; end if;
  else
    new.github_org_id := null;
  end if;
  return new;
end $$;
notify pgrst, 'reload schema';


-- Source: 041-organization-account-github-grant.sql
-- Organization accounts authorize through a GitHub organization owner.
-- Personal identity linking remains required for personal memberships.

create or replace function public.is_verified_github_org_member(p_org bigint)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.github_org_memberships m
    where m.user_id = auth.uid() and m.org_id = p_org and m.valid_until > now()
      and (
        exists (select 1 from auth.identities i where i.user_id = m.user_id and i.provider = 'github'
          and m.github_user_id::text in (i.identity_data->>'provider_id', i.identity_data->>'sub', i.identity_data->>'id'))
        or (m.role = 'admin' and exists (
          select 1 from public.github_org_accounts a join public.profiles p on p.id = a.account_id
          where a.account_id = m.user_id and a.org_id = m.org_id and p.is_org = true
        ))
      )
  );
$$;
revoke all on function public.is_verified_github_org_member(bigint) from public, anon;
grant execute on function public.is_verified_github_org_member(bigint) to anon, authenticated;
notify pgrst, 'reload schema';

notify pgrst, 'reload schema';

-- Requires the Organization setup repair (Stages 38, 39, 41).

alter table public.github_org_accounts add column if not exists verification_method text;
alter table public.github_org_accounts add column if not exists verification_token text;
create table if not exists public.github_org_file_challenges (
  account_id uuid primary key references public.profiles(id) on delete cascade,
  org_id bigint not null,
  login text not null,
  token text not null,
  expires_at timestamptz not null
);
alter table public.github_org_file_challenges enable row level security;
revoke all on public.github_org_file_challenges from public, anon, authenticated;
grant all on public.github_org_file_challenges to service_role;

create or replace function public.confirm_github_org_file(p_account uuid, p_token text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.github_org_file_challenges;
begin
  perform 1 from public.profiles where id = p_account and is_org = true for update;
  if not found then raise exception 'Organization account required'; end if;
  select * into c from public.github_org_file_challenges where account_id = p_account for update;
  if not found or c.token <> p_token or c.expires_at <= now() then raise exception 'Verification code expired or replaced'; end if;
  insert into public.github_org_accounts(account_id,org_id,login,verification_method,verification_token)
  values(p_account,c.org_id,c.login,'file',c.token)
  on conflict(account_id) do update set org_id=excluded.org_id,login=excluded.login,verification_method='file',verification_token=excluded.verification_token;
  update public.profiles set github_handle=c.login,github_verified=true where id=p_account;
  perform public.replace_github_org_memberships(p_account,0,jsonb_build_array(jsonb_build_object('id',c.org_id,'login',c.login,'role','organization_file')));
  delete from public.github_org_file_challenges where account_id=p_account;
end $$;
revoke all on function public.confirm_github_org_file(uuid,text) from public,anon,authenticated;
grant execute on function public.confirm_github_org_file(uuid,text) to service_role;

create or replace function public.is_verified_github_org_member(p_org bigint)
returns boolean language sql stable security definer set search_path = public,auth as $$
  select exists (
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
revoke all on function public.is_verified_github_org_member(bigint) from public,anon;
grant execute on function public.is_verified_github_org_member(bigint) to anon,authenticated;
notify pgrst, 'reload schema';

commit;
